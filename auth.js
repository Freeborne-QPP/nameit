// 认证与会话：HMAC 签名 Cookie + scrypt 密码哈希
const crypto = require('crypto');

const SECRET_KEY = 'zm_secret';
const SESSION_KEY = 'zm_sid';
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

// token -> {uid, admin, exp} | null
function parseSession(token, secret) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(payload, secret) !== sig) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!obj || typeof obj.exp !== 'number' || obj.exp < Date.now()) return null;
    return { uid: obj.uid ?? null, admin: !!obj.admin };
  } catch {
    return null;
  }
}

function createSession(secret, opts = {}) {
  const payload = Buffer.from(JSON.stringify({
    uid: opts.uid ?? null,
    admin: !!opts.admin,
    exp: Date.now() + SESSION_TTL,
  })).toString('base64url');
  return payload + '.' + sign(payload, secret);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

module.exports = { sign, parseSession, createSession, hashPassword, SECRET_KEY, SESSION_KEY };
