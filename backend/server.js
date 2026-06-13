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

    const abnormalItems = checkResults.filter(cr => cr.result === 'abnormal');
    const totalPhotos = (req.files || []).length;
    const abnormalCount = abnormalItems.length;

    if (abnormalCount > 0 && totalPhotos === 0) {
      return res.status(400).json({ error: '存在异常项，必须上传照片' });
    }
    if (totalPhotos > abnormalCount * 3) {
      return res.status(400).json({ error: '照片总数超出限制，每个异常项最多3张' });
    }

    const photoIndexMap = new Map();
    if (totalPhotos > 0) {
      let photoIdx = 0;
      for (const cr of checkResults) {
        if (cr.result === 'abnormal') {
          let itemPhotoCount = cr.photo_count;
          if (itemPhotoCount === undefined || itemPhotoCount === null) {
            itemPhotoCount = cr.photos ? cr.photos.length : 0;
          }
          itemPhotoCount = parseInt(itemPhotoCount) || 0;

          if (itemPhotoCount < 1) {
            return res.status(400).json({ error: `异常项 "${cr.item_name}" 必须上传至少一张照片` });
          }
          if (itemPhotoCount > 3) {
            return res.status(400).json({ error: `异常项 "${cr.item_name}" 最多只能上传3张照片` });
          }

          const itemPhotos = [];
          for (let i = 0; i < itemPhotoCount && photoIdx < totalPhotos; i++) {
            itemPhotos.push(req.files[photoIdx]);
            photoIdx++;
          }

          if (itemPhotos.length < 1) {
            return res.status(400).json({ error: `异常项 "${cr.item_name}" 必须上传至少一张照片` });
          }

          photoIndexMap.set(cr.item_name, itemPhotos);
        }
      }

      if (photoIdx < totalPhotos) {
        return res.status(400).json({ error: '上传的照片数量与异常项不匹配' });
      }
    } else {
      for (const cr of checkResults) {
        if (cr.result === 'abnormal') {
          return res.status(400).json({ error: `异常项 "${cr.item_name}" 必须上传至少一张照片` });
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
      LEFT JOIN devices d ON wo.device_id = d.id
      LEFT JOIN production_lines pl ON d.line_id = pl.id
      LEFT JOIN check_results cr ON wo.check_result_id = cr.id
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
    const { assignee_name, spare_parts } = req.body;
    const orderId = req.params.id;

    if (!assignee_name || !assignee_name.trim()) {
      return res.status(400).json({ error: '维修人员姓名不能为空' });
    }

    const order = await get('SELECT * FROM work_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: '工单不存在' });
    if (order.status === 'in_progress') {
      return res.status(400).json({ error: '工单已被指派' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ error: '当前工单状态不允许指派' });
    }

    if (spare_parts && spare_parts.length > 0) {
      const partIdSet = new Set();
      for (const sp of spare_parts) {
        if (!sp.spare_part_id) {
          return res.status(400).json({ error: '备件列表中存在缺少 spare_part_id 的项' });
        }
        if (!sp.quantity || sp.quantity <= 0) {
          return res.status(400).json({ error: '备件数量必须大于0' });
        }
        if (partIdSet.has(sp.spare_part_id)) {
          return res.status(400).json({ error: `备件ID ${sp.spare_part_id} 重复` });
        }
        partIdSet.add(sp.spare_part_id);
      }

      const shortages = [];
      for (const sp of spare_parts) {
        const part = await get('SELECT * FROM spare_parts WHERE id = ?', [sp.spare_part_id]);
        if (!part) {
          return res.status(400).json({ error: `备件ID ${sp.spare_part_id} 不存在` });
        }
        if (part.current_stock < sp.quantity) {
          shortages.push({
            spare_part_id: part.id,
            name: part.name,
            spec_model: part.spec_model,
            required: sp.quantity,
            current_stock: part.current_stock,
            shortfall: sp.quantity - part.current_stock
          });
        }
      }

      if (shortages.length > 0) {
        return res.status(400).json({
          error: '库存不足，无法指派工单',
          shortages
        });
      }
    }

    await run('BEGIN TRANSACTION');

    try {
      await run(
        `UPDATE work_orders 
         SET status = 'in_progress', assignee_name = ?, assigned_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [assignee_name.trim(), orderId]
      );

      if (spare_parts && spare_parts.length > 0) {
        for (const sp of spare_parts) {
          await run(
            'INSERT INTO work_order_spare_parts (work_order_id, spare_part_id, quantity) VALUES (?, ?, ?)',
            [orderId, sp.spare_part_id, sp.quantity]
          );

          const result = await run(
            'UPDATE spare_parts SET current_stock = current_stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND current_stock >= ?',
            [sp.quantity, sp.spare_part_id, sp.quantity]
          );

          if (result.changes === 0) {
            throw new Error(`备件ID ${sp.spare_part_id} 库存不足，扣减失败`);
          }

          const part = await get('SELECT current_stock FROM spare_parts WHERE id = ?', [sp.spare_part_id]);

          await run(
            `INSERT INTO spare_part_stock_logs (spare_part_id, change_type, quantity, balance_after, related_id, remark) 
             VALUES (?, 'assign', ?, ?, ?, ?)`,
            [sp.spare_part_id, sp.quantity, part.current_stock, orderId, '工单指派扣减库存']
          );
        }
      }

      await run('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/cancel', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await get('SELECT * FROM work_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: '工单不存在' });

    if (order.status !== 'in_progress' && order.status !== 'pending') {
      return res.status(400).json({ error: '当前工单状态不允许取消' });
    }

    await run('BEGIN TRANSACTION');

    try {
      const assignedParts = await all(
        'SELECT * FROM work_order_spare_parts WHERE work_order_id = ?',
        [orderId]
      );

      for (const ap of assignedParts) {
        const part = await get('SELECT * FROM spare_parts WHERE id = ?', [ap.spare_part_id]);
        if (!part) continue;

        const newStock = part.current_stock + ap.quantity;

        await run(
          'UPDATE spare_parts SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newStock, ap.spare_part_id]
        );

        await run(
          `INSERT INTO spare_part_stock_logs (spare_part_id, change_type, quantity, balance_after, related_id, remark) 
           VALUES (?, 'rollback', ?, ?, ?, ?)`,
          [ap.spare_part_id, ap.quantity, newStock, orderId, '工单取消回滚库存']
        );
      }

      await run(
        `UPDATE work_orders 
         SET status = 'cancelled', assignee_name = NULL, assigned_at = NULL
         WHERE id = ?`,
        [orderId]
      );

      await run('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/reject', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { reason } = req.body;
    const orderId = req.params.id;

    const order = await get('SELECT * FROM work_orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ error: '工单不存在' });

    if (order.status !== 'in_progress' && order.status !== 'pending') {
      return res.status(400).json({ error: '当前工单状态不允许驳回' });
    }

    await run('BEGIN TRANSACTION');

    try {
      const assignedParts = await all(
        'SELECT * FROM work_order_spare_parts WHERE work_order_id = ?',
        [orderId]
      );

      for (const ap of assignedParts) {
        const part = await get('SELECT * FROM spare_parts WHERE id = ?', [ap.spare_part_id]);
        if (!part) continue;

        const newStock = part.current_stock + ap.quantity;

        await run(
          'UPDATE spare_parts SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newStock, ap.spare_part_id]
        );

        await run(
          `INSERT INTO spare_part_stock_logs (spare_part_id, change_type, quantity, balance_after, related_id, remark) 
           VALUES (?, 'rollback', ?, ?, ?, ?)`,
          [ap.spare_part_id, ap.quantity, newStock, orderId, reason || '工单驳回回滚库存']
        );
      }

      await run(
        `UPDATE work_orders 
         SET status = 'rejected', assignee_name = NULL, assigned_at = NULL
         WHERE id = ?`,
        [orderId]
      );

      await run('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/work-orders/:id/complete', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const order = await get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: '工单不存在' });
    if (order.status !== 'in_progress') {
      return res.status(400).json({ error: '当前工单状态不允许标记完成' });
    }
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
    const order = await get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: '工单不存在' });
    if (order.status !== 'completed') {
      return res.status(400).json({ error: '当前工单状态不允许验收' });
    }
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

app.get('/api/spare-parts', authMiddleware, async (req, res) => {
  try {
    const { line_id, keyword } = req.query;
    let sql = `
      SELECT sp.*, pl.name as line_name 
      FROM spare_parts sp
      LEFT JOIN production_lines pl ON sp.line_id = pl.id
      WHERE 1=1
    `;
    const params = [];

    if (line_id) {
      sql += ' AND sp.line_id = ?';
      params.push(line_id);
    }
    if (keyword) {
      sql += ' AND (sp.name LIKE ? OR sp.spec_model LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    sql += ' ORDER BY sp.id DESC';

    const parts = await all(sql, params);
    res.json(parts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/spare-parts/:id', authMiddleware, async (req, res) => {
  try {
    const part = await get(`
      SELECT sp.*, pl.name as line_name 
      FROM spare_parts sp
      LEFT JOIN production_lines pl ON sp.line_id = pl.id
      WHERE sp.id = ?
    `, [req.params.id]);

    if (!part) return res.status(404).json({ error: '备件不存在' });
    res.json(part);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spare-parts', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { name, spec_model, line_id, safety_stock, current_stock } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '备件名称不能为空' });
    }
    if (!spec_model || !spec_model.trim()) {
      return res.status(400).json({ error: '规格型号不能为空' });
    }
    if (!line_id) {
      return res.status(400).json({ error: '所属产线不能为空' });
    }
    if (safety_stock === undefined || safety_stock < 0) {
      return res.status(400).json({ error: '安全库存量不能为负数' });
    }
    if (current_stock === undefined || current_stock < 0) {
      return res.status(400).json({ error: '当前库存量不能为负数' });
    }

    const existing = await get(
      'SELECT id FROM spare_parts WHERE name = ? AND spec_model = ?',
      [name.trim(), spec_model.trim()]
    );
    if (existing) {
      return res.status(400).json({ error: '该备件名称+规格型号已存在，不能重复录入' });
    }

    const line = await get('SELECT id FROM production_lines WHERE id = ?', [line_id]);
    if (!line) {
      return res.status(400).json({ error: '所属产线不存在' });
    }

    const result = await run(
      `INSERT INTO spare_parts (name, spec_model, line_id, safety_stock, current_stock) 
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), spec_model.trim(), line_id, safety_stock, current_stock || 0]
    );

    const newPart = await get('SELECT * FROM spare_parts WHERE id = ?', [result.id]);
    res.status(201).json(newPart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/spare-parts/:id', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const { name, spec_model, line_id, safety_stock, current_stock } = req.body;
    const partId = req.params.id;

    const existing = await get('SELECT * FROM spare_parts WHERE id = ?', [partId]);
    if (!existing) return res.status(404).json({ error: '备件不存在' });

    if (name !== undefined && spec_model !== undefined) {
      const duplicate = await get(
        'SELECT id FROM spare_parts WHERE name = ? AND spec_model = ? AND id != ?',
        [name.trim(), spec_model.trim(), partId]
      );
      if (duplicate) {
        return res.status(400).json({ error: '该备件名称+规格型号已存在' });
      }
    }

    if (line_id !== undefined) {
      const line = await get('SELECT id FROM production_lines WHERE id = ?', [line_id]);
      if (!line) {
        return res.status(400).json({ error: '所属产线不存在' });
      }
    }

    if (safety_stock !== undefined && safety_stock < 0) {
      return res.status(400).json({ error: '安全库存量不能为负数' });
    }
    if (current_stock !== undefined && current_stock < 0) {
      return res.status(400).json({ error: '当前库存量不能为负数' });
    }

    await run(
      `UPDATE spare_parts 
       SET name = COALESCE(?, name), 
           spec_model = COALESCE(?, spec_model), 
           line_id = COALESCE(?, line_id), 
           safety_stock = COALESCE(?, safety_stock), 
           current_stock = COALESCE(?, current_stock),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        name ? name.trim() : null,
        spec_model ? spec_model.trim() : null,
        line_id || null,
        safety_stock !== undefined ? safety_stock : null,
        current_stock !== undefined ? current_stock : null,
        partId
      ]
    );

    const updated = await get('SELECT * FROM spare_parts WHERE id = ?', [partId]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/spare-parts/:id', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const existing = await get('SELECT * FROM spare_parts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '备件不存在' });

    await run('DELETE FROM spare_parts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/spare-parts/stock-in', authMiddleware, roleMiddleware('supervisor'), async (req, res) => {
  try {
    const items = req.body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '入库列表不能为空' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: '一次最多入库50条' });
    }

    for (const item of items) {
      if (!item.spare_part_id) {
        return res.status(400).json({ error: '每条记录必须包含 spare_part_id' });
      }
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: '入库数量必须大于0' });
      }
    }

    await run('BEGIN TRANSACTION');
    const results = [];

    try {
      for (const item of items) {
        const part = await get('SELECT * FROM spare_parts WHERE id = ?', [item.spare_part_id]);
        if (!part) {
          throw new Error(`备件ID ${item.spare_part_id} 不存在`);
        }

        const newStock = part.current_stock + item.quantity;

        await run(
          'UPDATE spare_parts SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newStock, item.spare_part_id]
        );

        await run(
          `INSERT INTO spare_part_stock_logs (spare_part_id, change_type, quantity, balance_after, related_id, remark) 
           VALUES (?, 'stock_in', ?, ?, NULL, ?)`,
          [item.spare_part_id, item.quantity, newStock, item.remark || '批量入库']
        );

        results.push({
          spare_part_id: item.spare_part_id,
          name: part.name,
          spec_model: part.spec_model,
          quantity: item.quantity,
          stock_before: part.current_stock,
          stock_after: newStock
        });
      }

      await run('COMMIT');
      res.json({ success: true, results });
    } catch (err) {
      await run('ROLLBACK');
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/spare-parts/warnings/low-stock', authMiddleware, async (req, res) => {
  try {
    const warnings = await all(`
      SELECT sp.*, pl.name as line_name,
             (sp.safety_stock - sp.current_stock) as shortage
      FROM spare_parts sp
      LEFT JOIN production_lines pl ON sp.line_id = pl.id
      WHERE sp.current_stock < sp.safety_stock
      ORDER BY shortage DESC
    `);

    res.json(warnings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/work-orders/:id/spare-parts', authMiddleware, async (req, res) => {
  try {
    const order = await get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: '工单不存在' });

    const parts = await all(`
      SELECT wosp.*, sp.name, sp.spec_model, sp.current_stock, sp.safety_stock, pl.name as line_name
      FROM work_order_spare_parts wosp
      JOIN spare_parts sp ON wosp.spare_part_id = sp.id
      LEFT JOIN production_lines pl ON sp.line_id = pl.id
      WHERE wosp.work_order_id = ?
      ORDER BY wosp.id
    `, [req.params.id]);

    res.json(parts);
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
