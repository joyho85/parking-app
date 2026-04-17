const { sendJson, clearSessionCookie } = require('./_common');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  clearSessionCookie(res, req);
  return sendJson(res, 200, { ok: true });
};