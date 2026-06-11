const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const { initDB, run, get, all } = require('./database');

const app = express();
const JWT_SECRET = 'inspection-system-secret-key-2024';
const TOKEN_EXPIRES_IN = '2h';
const PORT = 3001;

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('只允许上传图片文件'));
    cb(null, true);
  }
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );
    res.json({
      token,
      user: { id: user.id, username: user.username, name: user.name, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/users', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const users = await all('SELECT id, username, name, role, created_at FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inspectors', authMiddleware, async (req, res) => {
  try {
    const inspectors = await all("SELECT id, username, name FROM users WHERE role = 'inspector'");
    res.json(inspectors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/lines', authMiddleware, async (req, res) => {
  try {
    const lines = await all('SELECT * FROM production_lines ORDER BY id');
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lines', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const result = await run('INSERT INTO production_lines (name, description) VALUES (?, ?)', [name, description || '']);
    res.json({ id: result.id, name, description });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices', authMiddleware, async (req, res) => {
  try {
    const { line_id } = req.query;
    let sql = `SELECT d.*, pl.name as line_name 
               FROM devices d 
               LEFT JOIN production_lines pl ON d.line_id = pl.id`;
    const params = [];
    if (line_id) {
      sql += ' WHERE d.line_id = ?';
      params.push(line_id);
    }
    sql += ' ORDER BY d.id';
    const devices = await all(sql, params);
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { name, code, line_id, location } = req.body;
    const result = await run(
      'INSERT INTO devices (name, code, line_id, location) VALUES (?, ?, ?, ?)',
      [name, code, line_id, location || '']
    );
    res.json({ id: result.id, name, code, line_id, location });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/templates', authMiddleware, async (req, res) => {
  try {
    const templates = await all(`
      SELECT t.*, u.name as assigned_user_name, u2.name as creator_name
      FROM inspection_templates t
      LEFT JOIN users u ON t.assigned_user_id = u.id
      LEFT JOIN users u2 ON t.created_by = u2.id
      ORDER BY t.id DESC
    `);
    for (const tpl of templates) {
      tpl.devices = await all(`
        SELECT td.*, d.name as device_name, d.code as device_code
        FROM template_devices td
        JOIN devices d ON td.device_id = d.id
        WHERE td.template_id = ?
        ORDER BY td.order_index
      `, [tpl.id]);
      for (const dev of tpl.devices) {
        dev.check_items = await all(
          'SELECT * FROM template_check_items WHERE template_device_id = ?',
          [dev.id]
        );
      }
    }
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { name, cycle_type, cycle_weekdays, assigned_user_id, is_active, devices } = req.body;
    const result = await run(
      `INSERT INTO inspection_templates (name, cycle_type, cycle_weekdays, assigned_user_id, is_active, created_by) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, cycle_type, cycle_weekdays || null, assigned_user_id || null, is_active ? 1 : 0, req.user.id]
    );
    const templateId = result.id;

    for (let i = 0; i < devices.length; i++) {
      const dev = devices[i];
      const tdResult = await run(
        'INSERT INTO template_devices (template_id, device_id, order_index) VALUES (?, ?, ?)',
        [templateId, dev.device_id, i]
      );
      if (dev.check_items && dev.check_items.length > 0) {
        for (const item of dev.check_items) {
          await run(
            'INSERT INTO template_check_items (template_device_id, item_name, description) VALUES (?, ?, ?)',
            [tdResult.id, item.item_name, item.description || '']
          );
        }
      }
    }
    res.json({ id: templateId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/templates/:id', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const templateId = req.params.id;
    const { name, cycle_type, cycle_weekdays, assigned_user_id, is_active, devices } = req.body;
    await run(
      `UPDATE inspection_templates SET name = ?, cycle_type = ?, cycle_weekdays = ?, assigned_user_id = ?, is_active = ? 
       WHERE id = ?`,
      [name, cycle_type, cycle_weekdays || null, assigned_user_id || null, is_active ? 1 : 0, templateId]
    );
    await run('DELETE FROM template_devices WHERE template_id = ?', [templateId]);
    for (let i = 0; i < devices.length; i++) {
      const dev = devices[i];
      const tdResult = await run(
        'INSERT INTO template_devices (template_id, device_id, order_index) VALUES (?, ?, ?)',
        [templateId, dev.device_id, i]
      );
      if (dev.check_items && dev.check_items.length > 0) {
        for (const item of dev.check_items) {
          await run(
            'INSERT INTO template_check_items (template_device_id, item_name, description) VALUES (?, ?, ?)',
            [tdResult.id, item.item_name, item.description || '']
          );
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    await run('DELETE FROM inspection_templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function generateDailyTasks() {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay();

  const templates = await all(`
    SELECT t.* FROM inspection_templates t
    WHERE t.is_active = 1 AND t.assigned_user_id IS NOT NULL
  `);

  for (const tpl of templates) {
    let shouldGenerate = false;
    if (tpl.cycle_type === 'daily') {
      shouldGenerate = true;
    } else if (tpl.cycle_type === 'weekly' && tpl.cycle_weekdays) {
      const weekdays = JSON.parse(tpl.cycle_weekdays);
      shouldGenerate = weekdays.includes(dayOfWeek);
    }
    if (!shouldGenerate) continue;

    const existing = await get(
      'SELECT id FROM inspection_tasks WHERE template_id = ? AND task_date = ?',
      [tpl.id, today]
    );
    if (existing) continue;

    const taskResult = await run(
      `INSERT INTO inspection_tasks (template_id, task_date, assigned_user_id, status) 
       VALUES (?, ?, ?, 'pending')`,
      [tpl.id, today, tpl.assigned_user_id]
    );

    const devices = await all(
      'SELECT * FROM template_devices WHERE template_id = ? ORDER BY order_index',
      [tpl.id]
    );
    for (const dev of devices) {
      await run(
        'INSERT INTO task_devices (task_id, device_id, order_index, status) VALUES (?, ?, ?, ?)',
        [taskResult.id, dev.device_id, dev.order_index, 'pending']
      );
    }
  }
  console.log(`[${new Date().toISOString()}] 巡检任务生成完成`);
}

app.post('/api/tasks/generate-today', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    await generateDailyTasks();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const { status, date } = req.query;
    let sql = `
      SELECT t.*, it.name as template_name, u.name as assigned_user_name
      FROM inspection_tasks t
      LEFT JOIN inspection_templates it ON t.template_id = it.id
      LEFT JOIN users u ON t.assigned_user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'inspector') {
      sql += ' AND t.assigned_user_id = ?';
      params.push(req.user.id);
    }
    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (date) {
      sql += ' AND t.task_date = ?';
      params.push(date);
    }
    sql += ' ORDER BY t.task_date DESC, t.id DESC';

    const tasks = await all(sql, params);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const task = await get(`
      SELECT t.*, it.name as template_name, u.name as assigned_user_name
      FROM inspection_tasks t
      LEFT JOIN inspection_templates it ON t.template_id = it.id
      LEFT JOIN users u ON t.assigned_user_id = u.id
      WHERE t.id = ?
    `, [req.params.id]);

    if (!task) return res.status(404).json({ error: '任务不存在' });

    if (req.user.role === 'inspector' && task.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看此任务' });
    }

    const devices = await all(`
      SELECT td.*, d.name as device_name, d.code as device_code, d.location, pl.name as line_name
      FROM task_devices td
      JOIN devices d ON td.device_id = d.id
      LEFT JOIN production_lines pl ON d.line_id = pl.id
      WHERE td.task_id = ?
      ORDER BY td.order_index
    `, [task.id]);

    for (const dev of devices) {
      const tplDev = await get(`
        SELECT td.id as template_device_id
        FROM template_devices td
        WHERE td.template_id = ? AND td.device_id = ?
      `, [task.template_id, dev.device_id]);

      if (tplDev) {
        dev.check_items = await all(
          'SELECT * FROM template_check_items WHERE template_device_id = ?',
          [tplDev.template_device_id]
        );
      } else {
        dev.check_items = [];
      }

      dev.results = await all(
        `SELECT cr.* FROM check_results cr WHERE cr.task_device_id = ?`,
        [dev.id]
      );
      for (const r of dev.results) {
        r.photos = await all('SELECT * FROM photos WHERE check_result_id = ?', [r.id]);
      }
    }

    task.devices = devices;
    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:taskId/devices/:deviceId/submit', authMiddleware, upload.array('photos', 3), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const deviceId = req.params.deviceId;
    const inspectorId = req.user.id;

    const task = await get('SELECT * FROM inspection_tasks WHERE id = ?', [taskId]);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    if (task.assigned_user_id !== inspectorId) {
      return res.status(403).json({ error: '这不是分配给你的任务' });
    }
    if (task.status === 'completed') {
      return res.status(400).json({ error: '任务已完成，不能再提交' });
    }

    const taskDevice = await get(
      'SELECT * FROM task_devices WHERE task_id = ? AND device_id = ?',
      [taskId, deviceId]
    );
    if (!taskDevice) return res.status(404).json({ error: '设备不在该任务中' });

    const prevDevice = await get(
      `SELECT * FROM task_devices 
       WHERE task_id = ? AND order_index < ? AND status = 'pending'
       ORDER BY order_index DESC LIMIT 1`,
      [taskId, taskDevice.order_index]
    );
    if (prevDevice) {
      return res.status(400).json({ error: '必须按路线顺序逐台提交，请先完成前面的设备检查' });
    }

    if (taskDevice.status === 'completed') {
      const existingResults = await all(
        'SELECT cr.* FROM check_results cr WHERE cr.task_device_id = ?',
        [taskDevice.id]
      );
      for (const r of existingResults) {
        r.photos = await all('SELECT * FROM photos WHERE check_result_id = ?', [r.id]);
      }
      return res.json({
        message: '该设备已提交过（幂等处理），返回已有结果',
        idempotent: true,
        results: existingResults
      });
    }

    let checkResults = [];
    if (req.body.check_results) {
      try {
        checkResults = typeof req.body.check_results === 'string'
          ? JSON.parse(req.body.check_results)
          : req.body.check_results;
      } catch (e) {
        return res.status(400).json({ error: 'check_results 格式错误' });
      }
    }

    const tplDev = await get(`
      SELECT td.id as template_device_id
      FROM template_devices td
      WHERE td.template_id = ? AND td.device_id = ?
    `, [task.template_id, deviceId]);

    let requiredItems = [];
    if (tplDev) {
      requiredItems = await all('SELECT * FROM template_check_items WHERE template_device_id = ?', [tplDev.template_device_id]);
    }

    if (checkResults.length === 0 && requiredItems.length > 0) {
      return res.status(400).json({ error: '请填写检查项结果' });
    }

    const resultMap = new Map();
    for (const cr of checkResults) {
      if (!cr.item_name || !cr.result) {
        return res.status(400).json({ error: '检查项缺少 item_name 或 result' });
      }
      if (cr.result === 'abnormal') {
        if (!cr.remark || !cr.remark.trim()) {
          return res.status(400).json({ error: `异常项 "${cr.item_name}" 必须填写文字说明` });
        }
      }
      resultMap.set(cr.item_name, cr);
    }

    for (const item of requiredItems) {
      if (!resultMap.has(item.item_name)) {
        return res.status(400).json({ error: `缺少检查项 "${item.item_name}" 的结果` });
      }
    }

    const photoIndexMap = new Map();
    if (req.files && req.files.length > 0) {
      let photoIdx = 0;
      for (const cr of checkResults) {
        if (cr.result === 'abnormal') {
          const photoCount = cr.photo_count || (cr.photos && cr.photos.length) || 0;
          const itemPhotos = [];
          for (let i = 0; i < photoCount && photoIdx < req.files.length; i++) {
            itemPhotos.push(req.files[photoIdx]);
            photoIdx++;
          }
          if (photoCount > 0 && itemPhotos.length === 0) {
            return res.status(400).json({ error: `异常项 "${cr.item_name}" 必须上传至少一张照片` });
          }
          if (photoCount > 3) {
            return res.status(400).json({ error: `异常项 "${cr.item_name}" 最多只能上传3张照片` });
          }
          photoIndexMap.set(cr.item_name, itemPhotos);
        }
      }
    }

    await run('BEGIN TRANSACTION');
    try {
      for (const cr of checkResults) {
        const result = await run(
          `INSERT OR IGNORE INTO check_results (task_device_id, item_name, result, remark) 
           VALUES (?, ?, ?, ?)`,
          [taskDevice.id, cr.item_name, cr.result, cr.remark || null]
        );

        let checkResultId = result.id;
        if (result.changes === 0) {
          const existing = await get(
            'SELECT id FROM check_results WHERE task_device_id = ? AND item_name = ?',
            [taskDevice.id, cr.item_name]
          );
          checkResultId = existing.id;
        }

        if (cr.result === 'abnormal') {
          const files = photoIndexMap.get(cr.item_name) || [];
          for (const file of files) {
            const relPath = `/uploads/${path.basename(file.path)}`;
            await run(
              'INSERT INTO photos (check_result_id, file_path, original_name) VALUES (?, ?, ?)',
              [checkResultId, relPath, file.originalname]
            );
          }

          const existingWO = await get('SELECT id FROM work_orders WHERE check_result_id = ?', [checkResultId]);
          if (!existingWO) {
            const device = await get('SELECT name FROM devices WHERE id = ?', [deviceId]);
            await run(
              `INSERT INTO work_orders (task_device_id, check_result_id, device_id, title, description, status) 
               VALUES (?, ?, ?, ?, ?, 'pending')`,
              [
                taskDevice.id,
                checkResultId,
                deviceId,
                `[${device.name}] ${cr.item_name}异常`,
                cr.remark || ''
              ]
            );
          }
        }
      }

      await run(
        `UPDATE task_devices SET status = 'completed', submitted_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [taskDevice.id]
      );

      const remaining = await get(
        `SELECT COUNT(*) as cnt FROM task_devices WHERE task_id = ? AND status = 'pending'`,
        [taskId]
      );

      if (remaining.cnt === 0) {
        await run(
          `UPDATE inspection_tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [taskId]
        );
      } else if (task.status === 'pending') {
        await run(`UPDATE inspection_tasks SET status = 'in_progress' WHERE id = ?`, [taskId]);
      }

      await run('COMMIT');
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }

    const finalResults = await all(
      'SELECT cr.* FROM check_results cr WHERE cr.task_device_id = ?',
      [taskDevice.id]
    );
    for (const r of finalResults) {
      r.photos = await all('SELECT * FROM photos WHERE check_result_id = ?', [r.id]);
    }

    res.json({ success: true, results: finalResults, idempotent: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/work-orders', authMiddleware, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `
      SELECT wo.*, d.name as device_name, d.code as device_code, pl.name as line_name,
             cr.item_name, cr.remark as defect_remark
      FROM work_orders wo
      JOIN devices d ON wo.device_id = d.id
      LEFT JOIN production_lines pl ON d.line_id = pl.id
      JOIN check_results cr ON wo.check_result_id = cr.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      sql += ' AND wo.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY wo.id DESC';
    const orders = await all(sql, params);

    for (const o of orders) {
      o.photos = await all('SELECT * FROM photos WHERE check_result_id = ?', [o.check_result_id]);
    }
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/assign', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { assignee_name } = req.body;
    if (!assignee_name || !assignee_name.trim()) {
      return res.status(400).json({ error: '维修人员姓名不能为空' });
    }
    await run(
      `UPDATE work_orders SET status = 'in_progress', assignee_name = ?, assigned_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [assignee_name.trim(), req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/complete', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    await run(
      `UPDATE work_orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/accept', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    await run(
      `UPDATE work_orders SET status = 'accepted', accepted_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/dashboard', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const mondayStr = monday.toISOString().split('T')[0];

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const sundayStr = sunday.toISOString().split('T')[0];

    const totalTasksRow = await get(
      'SELECT COUNT(*) as cnt FROM inspection_tasks WHERE task_date BETWEEN ? AND ?',
      [mondayStr, sundayStr]
    );
    const completedTasksRow = await get(
      `SELECT COUNT(*) as cnt FROM inspection_tasks 
       WHERE task_date BETWEEN ? AND ? AND status = 'completed'`,
      [mondayStr, sundayStr]
    );

    const totalTasks = totalTasksRow.cnt;
    const completedTasks = completedTasksRow.cnt;
    const completionRate = totalTasks === 0 ? 0 : Number((completedTasks / totalTasks * 100).toFixed(1));

    const openOrdersRow = await get(
      `SELECT COUNT(*) as cnt FROM work_orders WHERE status IN ('pending', 'in_progress', 'completed')`
    );

    const topDevices = await all(`
      SELECT d.id, d.name, d.code, pl.name as line_name,
             COUNT(DISTINCT wo.id) as abnormal_count
      FROM work_orders wo
      JOIN devices d ON wo.device_id = d.id
      LEFT JOIN production_lines pl ON d.line_id = pl.id
      WHERE wo.created_at >= ?
      GROUP BY d.id
      ORDER BY abnormal_count DESC
      LIMIT 5
    `, [mondayStr]);

    const lineStats = await all(`
      SELECT pl.id, pl.name,
             COUNT(DISTINCT wo.id) as abnormal_count
      FROM work_orders wo
      JOIN devices d ON wo.device_id = d.id
      LEFT JOIN production_lines pl ON d.line_id = pl.id
      WHERE wo.created_at >= ?
      GROUP BY pl.id
      ORDER BY abnormal_count DESC
    `, [mondayStr]);

    res.json({
      weekRange: { start: mondayStr, end: sundayStr },
      completionRate,
      totalTasks,
      completedTasks,
      pendingTasks: totalTasks - completedTasks,
      openWorkOrders: openOrdersRow.cnt,
      topAbnormalDevices: topDevices,
      lineAbnormalStats: lineStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '单个照片文件大小不能超过5MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  res.status(400).json({ error: err.message });
});

async function start() {
  await initDB();
  await generateDailyTasks();
  app.listen(PORT, () => {
    console.log(`后端服务运行在 http://localhost:${PORT}`);
  });

  cron.schedule('0 0 * * *', async () => {
    console.log('执行每日任务生成...');
    await generateDailyTasks();
  }, { timezone: 'Asia/Shanghai' });
}

start();
