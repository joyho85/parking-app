const crypto = require('crypto');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Line-Signature',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  const headers = corsHeaders();
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const cookies = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createSessionToken(username, secret) {
  const payload = {
    username,
    iat: Date.now(),
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = sign(encoded, secret);
  return `${encoded}.${signature}`;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) return null;
  const [encoded, signature] = String(token).split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded, secret);
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!ok) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return payload;
  } catch {
    return null;
  }
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

function getSecureFlag(req) {
  const host = req.headers.host || '';
  return !host.startsWith('localhost') && !host.startsWith('127.0.0.1');
}

function setSessionCookie(res, username, secret, req) {
  const token = createSessionToken(username, secret);
  res.setHeader(
    'Set-Cookie',
    buildCookie('parking_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: getSecureFlag(req),
      maxAge: 60 * 60 * 24 * 30,
    })
  );
}

function clearSessionCookie(res, req) {
  res.setHeader(
    'Set-Cookie',
    buildCookie('parking_session', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: getSecureFlag(req),
      maxAge: 0,
    })
  );
}

function requireSession(req, res) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    sendJson(res, 500, { error: '伺服器尚未設定 SESSION_SECRET' });
    return null;
  }

  const cookies = parseCookies(req);
  const payload = verifySessionToken(cookies.parking_session, secret);
  if (!payload?.username) {
    sendJson(res, 401, { error: '尚未登入' });
    return null;
  }
  return payload;
}

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數：${name}`);
  return value;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = {
  corsHeaders,
  sendJson,
  parseCookies,
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireSession,
  getEnv,
  readJsonBody,
  readRawBody,
};