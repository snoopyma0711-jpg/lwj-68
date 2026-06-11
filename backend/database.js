const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'inspection.db');
const db = new sqlite3.Database(dbPath);

function initDB() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA journal_mode=WAL');
      db.run('PRAGMA foreign_keys=ON');

      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('inspector', 'supervisor')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS production_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        line_id INTEGER NOT NULL,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (line_id) REFERENCES production_lines(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS inspection_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        cycle_type TEXT NOT NULL CHECK (cycle_type IN ('daily', 'weekly')),
        cycle_weekdays TEXT,
        assigned_user_id INTEGER,
        is_active INTEGER DEFAULT 1,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (assigned_user_id) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS template_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        device_id INTEGER NOT NULL,
        order_index INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES inspection_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS template_check_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_device_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        description TEXT,
        FOREIGN KEY (template_device_id) REFERENCES template_devices(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS inspection_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        task_date DATE NOT NULL,
        assigned_user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (template_id) REFERENCES inspection_templates(id),
        FOREIGN KEY (assigned_user_id) REFERENCES users(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS task_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        device_id INTEGER NOT NULL,
        order_index INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
        submitted_at DATETIME,
        FOREIGN KEY (task_id) REFERENCES inspection_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS check_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_device_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('normal', 'abnormal', 'skipped')),
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (task_device_id, item_name),
        FOREIGN KEY (task_device_id) REFERENCES task_devices(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_result_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (check_result_id) REFERENCES check_results(id) ON DELETE CASCADE
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS work_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_device_id INTEGER NOT NULL,
        check_result_id INTEGER NOT NULL,
        device_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'accepted')),
        assignee_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        assigned_at DATETIME,
        completed_at DATETIME,
        accepted_at DATETIME,
        UNIQUE (check_result_id),
        FOREIGN KEY (task_device_id) REFERENCES task_devices(id),
        FOREIGN KEY (check_result_id) REFERENCES check_results(id),
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )`);

      const defaultPassword = bcrypt.hashSync('123456', 10);

      const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password, name, role) VALUES (?, ?, ?, ?)');
      stmt.run('admin', defaultPassword, '系统主管', 'supervisor');
      stmt.run('inspector1', defaultPassword, '张三', 'inspector');
      stmt.run('inspector2', defaultPassword, '李四', 'inspector');
      stmt.finalize();

      db.run('INSERT OR IGNORE INTO production_lines (id, name, description) VALUES (1, ?, ?)', ['A产线', '主要产品组装线']);
      db.run('INSERT OR IGNORE INTO production_lines (id, name, description) VALUES (2, ?, ?)', ['B产线', '精密加工产线']);
      db.run('INSERT OR IGNORE INTO production_lines (id, name, description) VALUES (3, ?, ?)', ['C产线', '包装检验产线']);

      const devStmt = db.prepare('INSERT OR IGNORE INTO devices (name, code, line_id, location) VALUES (?, ?, ?, ?)');
      devStmt.run('CNC加工中心1号', 'CNC-001', 2, 'B区-01');
      devStmt.run('CNC加工中心2号', 'CNC-002', 2, 'B区-02');
      devStmt.run('注塑机A1', 'INJ-A1', 1, 'A区-01');
      devStmt.run('注塑机A2', 'INJ-A2', 1, 'A区-02');
      devStmt.run('传送带1号', 'CONV-01', 1, 'A区-中间');
      devStmt.run('包装机1号', 'PKG-001', 3, 'C区-01');
      devStmt.run('贴标机1号', 'LBL-001', 3, 'C区-02');
      devStmt.finalize();

      console.log('数据库初始化完成');
      resolve();
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function serialize(callback) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      callback().then(resolve).catch(reject);
    });
  });
}

module.exports = { db, initDB, run, get, all, serialize };
