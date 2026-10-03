// 麦版正赛阵容取名网站 —— 服务器入口
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { openDb, loadConfig } = require('./db');
const { parseSession, createSession, hashPassword, SECRET_KEY, SESSION_KEY } = require('./auth');
const { normSearch } = require('./normalize');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PORT = process.env.PORT || 3000;
const LINEUPS_FILE = path.join(DATA_DIR, 'lineups.json');

const db = openDb(DATA_DIR);
const config = loadConfig(DATA_DIR, process.env);

if (!fs.existsSync(LINEUPS_FILE)) {
  console.error(`未找到 ${LINEUPS_FILE}，请先运行: npm run build:lineups`);
  process.exit(1);
}
const lineupData = JSON.parse(fs.readFileSync(LINEUPS_FILE, 'utf8'));
// 原始阵容快照：用于「还原」，也是重建内存数据的基准
const baseLineups = lineupData.lineups.map(l => ({ ...l }));
const baseByKey = new Map(baseLineups.map(l => [l.key, l]));
const baseRows = new Set(baseLineups.map(l => l.row));
const baseSeasonByRow = new Map(baseLineups.map(l => [l.row, l.season]));
let lineupByKey = new Map();

// 期号排序权重：数字期号按数值；R1-R20 排在 100 与 101 之间，J1-J5 排在 300 与 301 之间
function rowOrder(row) {
  if (typeof row === 'number') return row;
  let m = /^R(\d+)$/.exec(String(row));
  if (m) return 100 + Number(m[1]) / 1000;
  m = /^J(\d+)$/.exec(String(row));
  if (m) return 300 + Number(m[1]) / 1000;
  const n = Number(row);
  return Number.isFinite(n) ? n : 0;
}

// 把 SQLite 里的「覆盖层」合并进内存阵容数据：
// - 已存在的阵容：覆盖文本与冠军/首败标记（key 不变，所以名字和点赞都还在）
// - is_new 的阵容：追加进去（赛季按当前基础数据里的期号实时取，避免赛季划分调整后留旧值）
function rebuildLineups() {
  const byKey = new Map(baseLineups.map(l => [l.key, { ...l }]));
  const extras = [];
  for (const e of db.prepare('SELECT * FROM lineup_edits').all()) {
    if (e.is_new) {
      extras.push({
        key: e.key, row: e.row, col: e.col, raw: e.text, text: e.text,
        search: normSearch(e.text), season: baseSeasonByRow.get(e.row) || e.season,
        isChampion: !!e.is_champion, isShoubai: !!e.is_shoubai,
        isNew: true, edited: true,
      });
    } else {
      const l = byKey.get(e.key);
      if (!l) continue;
      l.text = e.text;
      l.search = normSearch(e.text);
      l.isChampion = !!e.is_champion;
      l.isShoubai = !!e.is_shoubai;
      l.edited = true;
    }
  }
  const all = [...byKey.values(), ...extras];
  all.sort((a, b) => rowOrder(a.row) - rowOrder(b.row) || a.col - b.col);
  lineupData.lineups = all;
  lineupByKey = new Map(all.map(l => [l.key, l]));
}
rebuildLineups();

const app = express();
app.use(express.json({ limit: '64kb' }));

// ---------- 会话 ----------
function currentSession(req) {
  return parseSession(req.cookiesToken, config.secret);
}
app.use((req, res, next) => {
  const cookie = req.headers.cookie || '';
  const m = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(SESSION_KEY + '='));
  req.cookiesToken = m ? decodeURIComponent(m.slice(SESSION_KEY.length + 1)) : null;
  req.session = currentSession(req);
  next();
});

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_KEY}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_KEY}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ---------- 工具 ----------
const userPublic = u => (u ? { id: u.id, nickname: u.nickname } : null);

function getLikesForName(nameId) {
  return db.prepare('SELECT COUNT(*) AS c FROM likes WHERE name_id = ?').get(nameId).c;
}

function myLike(nameId, uid) {
  if (!uid) return false;
  return !!db.prepare('SELECT 1 FROM likes WHERE name_id = ? AND user_id = ?').get(nameId, uid);
}

// ---------- 账号 ----------
function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 4 && pw.length <= 64;
}
function validateNickname(nk) {
  return typeof nk === 'string' && nk.trim().length >= 1 && nk.trim().length <= 16;
}

app.post('/api/register', (req, res) => {
  const nickname = (req.body.nickname || '').trim();
  const password = req.body.password || '';
  if (!validateNickname(nickname)) return res.status(400).json({ error: '昵称需为 1-16 个字符' });
  if (!validatePassword(password)) return res.status(400).json({ error: '密码需为 4-64 个字符' });
  const exists = db.prepare('SELECT 1 FROM users WHERE nickname = ?').get(nickname);
  if (exists) return res.status(400).json({ error: '该昵称已被占用' });
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO users (nickname, pass_hash, pass_salt, created_at) VALUES (?,?,?,?)')
    .run(nickname, hashPassword(password, salt), salt, new Date().toISOString());
  const user = { id: Number(info.lastInsertRowid), nickname };
  setSessionCookie(res, createSession(config.secret, { uid: user.id }));
  res.json({ user });
});

app.post('/api/login', (req, res) => {
  const nickname = (req.body.nickname || '').trim();
  const password = req.body.password || '';
  const u = db.prepare('SELECT * FROM users WHERE nickname = ?').get(nickname);
  if (!u) return res.status(400).json({ error: '昵称或密码错误' });
  if (hashPassword(password, u.pass_salt) !== u.pass_hash) return res.status(400).json({ error: '昵称或密码错误' });
  setSessionCookie(res, createSession(config.secret, { uid: u.id }));
  res.json({ user: userPublic(u) });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const s = req.session;
  if (!s) return res.json({ user: null, admin: false });
  if (s.admin) return res.json({ user: null, admin: true });
  const u = s.uid ? db.prepare('SELECT * FROM users WHERE id = ?').get(s.uid) : null;
  if (!u) return res.json({ user: null, admin: false });
  res.json({ user: userPublic(u), admin: false });
});

// ---------- 数据 ----------
app.get('/api/lineups', (req, res) => {
  res.json({ meta: lineupData.meta, lineups: lineupData.lineups });
});

app.get('/api/names', (req, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.lineup_key AS lineupKey, n.name, n.origin, n.created_at AS createdAt,
           n.author_id AS authorId, u.nickname AS author,
           (SELECT COUNT(*) FROM likes l WHERE l.name_id = n.id) AS likes
    FROM names n JOIN users u ON u.id = n.author_id
    ORDER BY n.created_at ASC
  `).all();
  const uid = req.session && req.session.uid;
  const admin = req.session && req.session.admin;
  const names = rows.map(r => ({
    ...r,
    likedByMe: myLike(r.id, uid),
    editable: admin || (!!uid && r.authorId === uid),
  }));
  res.json({ names });
});

app.post('/api/names', (req, res) => {
  if (!req.session || (!req.session.uid && !req.session.admin)) {
    return res.status(401).json({ error: '请先登录后再取名' });
  }
  const key = req.body.lineupKey;
  const name = (req.body.name || '').trim();
  const origin = (req.body.origin || '').trim();
  if (!lineupByKey.has(key)) return res.status(400).json({ error: '阵容不存在' });
  if (!name) return res.status(400).json({ error: '名字不能为空' });
  if (name.length > 200) return res.status(400).json({ error: '名字过长（最多200字）' });
  if (origin.length > 2000) return res.status(400).json({ error: '由来过长（最多2000字）' });
  const authorId = req.session.admin ? null : req.session.uid;
  const now = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO names (lineup_key, name, origin, author_id, created_at, updated_at) VALUES (?,?,?,?,?,?)'
  ).run(key, name, origin, authorId, now, now);
  const id = Number(info.lastInsertRowid);
  const row = db.prepare(`
    SELECT n.id, n.lineup_key AS lineupKey, n.name, n.origin, n.created_at AS createdAt,
           n.author_id AS authorId, u.nickname AS author
    FROM names n JOIN users u ON u.id = n.author_id WHERE n.id = ?
  `).get(id);
  const authorName = row ? row.author : null;
  res.json({ name: { ...row, author: authorName, likes: 0, likedByMe: false, editable: true } });
});

function loadName(id) {
  return db.prepare('SELECT * FROM names WHERE id = ?').get(id);
}

app.post('/api/names/:id/like', (req, res) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: '请先登录后再点赞' });
  const id = Number(req.params.id);
  const n = loadName(id);
  if (!n) return res.status(404).json({ error: '名字不存在' });
  const uid = req.session.uid;
  const existing = db.prepare('SELECT 1 FROM likes WHERE name_id = ? AND user_id = ?').get(id, uid);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE name_id = ? AND user_id = ?').run(id, uid);
  } else {
    db.prepare('INSERT INTO likes (name_id, user_id, created_at) VALUES (?,?,?)').run(id, uid, new Date().toISOString());
  }
  res.json({ likes: getLikesForName(id), liked: !existing });
});

function canEditName(req, n) {
  if (!req.session) return false;
  if (req.session.admin) return true;
  return req.session.uid === n.author_id;
}

app.put('/api/names/:id', (req, res) => {
  const id = Number(req.params.id);
  const n = loadName(id);
  if (!n) return res.status(404).json({ error: '名字不存在' });
  if (!canEditName(req, n)) return res.status(403).json({ error: '只能编辑自己贡献的名字' });
  const name = (req.body.name || '').trim();
  const origin = (req.body.origin || '').trim();
  if (!name) return res.status(400).json({ error: '名字不能为空' });
  if (name.length > 200) return res.status(400).json({ error: '名字过长' });
  if (origin.length > 2000) return res.status(400).json({ error: '由来过长' });
  db.prepare('UPDATE names SET name = ?, origin = ?, updated_at = ? WHERE id = ?')
    .run(name, origin, new Date().toISOString(), id);
  res.json({ ok: true });
});

app.delete('/api/names/:id', (req, res) => {
  const id = Number(req.params.id);
  const n = loadName(id);
  if (!n) return res.status(404).json({ error: '名字不存在' });
  if (!canEditName(req, n)) return res.status(403).json({ error: '只能删除自己贡献的名字' });
  db.prepare('DELETE FROM likes WHERE name_id = ?').run(id);
  db.prepare('DELETE FROM names WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- 管理 ----------
app.post('/api/admin/login', (req, res) => {
  const pw = req.body.password || '';
  const hash = crypto.scryptSync(pw, config.adminPassSalt, 32).toString('hex');
  if (hash !== config.adminPassHash) return res.status(400).json({ error: '管理员密码错误' });
  setSessionCookie(res, createSession(config.secret, { admin: true }));
  res.json({ admin: true });
});

app.post('/api/admin/password', (req, res) => {
  if (!req.session || !req.session.admin) return res.status(401).json({ error: '需要管理员权限' });
  const old = req.body.old || '';
  const hash = crypto.scryptSync(old, config.adminPassSalt, 32).toString('hex');
  if (hash !== config.adminPassHash) return res.status(400).json({ error: '原密码错误' });
  const next = req.body.next || '';
  if (!validatePassword(next)) return res.status(400).json({ error: '新密码需为 4-64 个字符' });
  const salt = crypto.randomBytes(16).toString('hex');
  config.adminPassSalt = salt;
  config.adminPassHash = crypto.scryptSync(next, salt, 32).toString('hex');
  const p = path.join(DATA_DIR, 'config.json');
  fs.writeFileSync(p, JSON.stringify(config, null, 2), { mode: 0o600 });
  res.json({ ok: true });
});

// ---------- 管理：阵容内容编辑 ----------
function requireAdmin(req, res) {
  if (!req.session || !req.session.admin) {
    res.status(403).json({ error: '需要管理员权限' });
    return false;
  }
  return true;
}

function readLineupText(body) {
  const text = String(body.text == null ? '' : body.text).trim();
  if (!text) return { error: '阵容文本不能为空' };
  if (text.length > 100) return { error: '阵容文本过长（最多 100 字）' };
  return { text };
}

// 修改已有阵容的文本 / 冠军 / 首败标记
app.put('/api/admin/lineups/:key', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const key = req.params.key;
  const base = baseByKey.get(key);
  if (!base) return res.status(404).json({ error: '阵容不存在' });
  const parsed = readLineupText(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  db.prepare(`
    INSERT INTO lineup_edits (key, text, is_champion, is_shoubai, is_new, row, col, season, updated_at)
    VALUES (?,?,?,?,0,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET
      text = excluded.text,
      is_champion = excluded.is_champion,
      is_shoubai = excluded.is_shoubai,
      is_new = 0,
      updated_at = excluded.updated_at
  `).run(key, parsed.text, req.body.isChampion ? 1 : 0, req.body.isShoubai ? 1 : 0,
    base.row, base.col, base.season, new Date().toISOString());
  rebuildLineups();
  res.json({ lineup: lineupByKey.get(key) });
});

// 给某一期追加一个新阵容（自动接在该期末尾）
app.post('/api/admin/lineups', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const row = Number(req.body.row);
  if (!Number.isInteger(row) || !baseRows.has(row)) {
    return res.status(400).json({ error: '期号不存在，请填写已有的期号' });
  }
  const parsed = readLineupText(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const season = baseLineups.find(l => l.row === row).season;
  const col = Math.max(0, ...lineupData.lineups.filter(l => l.row === row).map(l => l.col)) + 1;
  const key = `${row}-${col}`;
  if (lineupByKey.has(key)) return res.status(400).json({ error: '编号冲突，请重试' });
  db.prepare(`
    INSERT INTO lineup_edits (key, text, is_champion, is_shoubai, is_new, row, col, season, updated_at)
    VALUES (?,?,?,?,1,?,?,?,?)
  `).run(key, parsed.text, req.body.isChampion ? 1 : 0, req.body.isShoubai ? 1 : 0,
    row, col, season, new Date().toISOString());
  rebuildLineups();
  res.json({ lineup: lineupByKey.get(key) });
});

// 还原：删掉这条覆盖记录（已有阵容恢复原文；新增阵容被移除）
app.delete('/api/admin/lineups/:key', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const info = db.prepare('DELETE FROM lineup_edits WHERE key = ?').run(req.params.key);
  if (!info.changes) return res.status(404).json({ error: '这条阵容没有修改记录' });
  rebuildLineups();
  res.json({ ok: true });
});

// ---------- 静态资源 ----------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`麦版正赛阵容取名网站已启动: http://localhost:${PORT}`);
  console.log(`阵容数据: ${lineupData.lineups.length} 个阵容 / ${lineupData.meta.totalRows} 期`);
});
