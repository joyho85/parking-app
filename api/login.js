const { sendJson, setSessionCookie, getEnv, readJsonBody } = require('./_common');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const APP_USERNAME = getEnv('APP_USERNAME');
    const APP_PASSWORD = getEnv('APP_PASSWORD');
    const SESSION_SECRET = getEnv('SESSION_SECRET');

    const body = await readJsonBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (username !== APP_USERNAME || password !== APP_PASSWORD) {
      return sendJson(res, 401, { error: '帳號或密碼錯誤' });
    }

    setSessionCookie(res, username, SESSION_SECRET, req);
    return sendJson(res, 200, { ok: true, username });
  } catch (err) {
    console.error('login failed:', err);
    return sendJson(res, 500, { error: err.message || '登入失敗' });
  }
};