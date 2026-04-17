const { sendJson, parseCookies, verifySessionToken, getEnv } = require('./_common');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const SESSION_SECRET = getEnv('SESSION_SECRET');
    const cookies = parseCookies(req);
    const payload = verifySessionToken(cookies.parking_session, SESSION_SECRET);

    if (!payload?.username) {
      return sendJson(res, 200, { authenticated: false });
    }

    return sendJson(res, 200, {
      authenticated: true,
      username: payload.username,
    });
  } catch (err) {
    console.error('session failed:', err);
    return sendJson(res, 500, { error: err.message || '讀取 session 失敗' });
  }
};