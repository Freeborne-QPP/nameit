// 存储层：node:sqlite（内置，无原生依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lineup_key TEXT NOT NULL,
      name TEXT NOT NULL,
      origin TEXT DEFAULT '',
      author_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS likes (
      name_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (name_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_names_lineup ON names(lineup_key);
    CREATE INDEX IF NOT EXISTS idx_likes_name ON likes(name_id);
    -- 阵容覆盖层：管理员在网页上的修改只存这里，绝不改写 lineups.json
    -- is_new = 1 表示这是管理员新增的阵容（原始数据里没有）
    CREATE TABLE IF NOT EXISTS lineup_edits (
      key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      is_champion INTEGER NOT NULL DEFAULT 0,
      is_shoubai INTEGER NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      row INTEGER NOT NULL,
      col INTEGER NOT NULL,
      season TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lineup_edits_row ON lineup_edits(row);
  `);
  return db;
}

function loadConfig(dataDir, env) {
  const p = path.join(dataDir, 'config.json');
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const adminPassword = env.ADMIN_PASSWORD || 'admin123456';
  const salt = crypto.randomBytes(16).toString('hex');
  const cfg = {
    secret: crypto.randomBytes(32).toString('hex'),
    adminPassSalt: salt,
    adminPassHash: crypto.scryptSync(adminPassword, salt, 32).toString('hex'),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

module.exports = { openDb, loadConfig };
