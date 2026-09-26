// 麦版正赛阵容取名网站 —— 服务器入口
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { openDb, loadConfig } = require('./db');
const { parseSession, createSession, hashPassword, SECRET_KEY, SESSION_KEY } = require('./auth');

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
const lineupByKey = new Map(lineupData.lineups.map(l => [l.key, l]));

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

// ---------- 静态资源 ----------
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`麦版正赛阵容取名网站已启动: http://localhost:${PORT}`);
  console.log(`阵容数据: ${lineupData.lineups.length} 个阵容 / ${lineupData.meta.totalRows} 期`);
});
