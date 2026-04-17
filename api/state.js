const { sendJson, requireSession, getEnv, readJsonBody } = require('./_common');

const APP_STATE_KEY = 'home_parking';

function defaultState() {
  return {
    settings: {
      lotName: '何家月租停車場',
      reminderDays: 7,
      familyRentDefault: 0,
      lineAdminUsers: [],
    },
    tenants: [],
    payments: [],
  };
}

async function fetchAppState() {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/app_state?key=eq.${APP_STATE_KEY}&select=state`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`讀取 app_state 失敗: ${res.status} ${text}`);
  }

  const rows = await res.json();
  return rows?.[0]?.state || defaultState();
}

async function saveAppState(state) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_state?key=eq.${APP_STATE_KEY}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      state,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`更新 app_state 失敗: ${res.status} ${text}`);
  }

  return res.json();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  const auth = requireSession(req, res);
  if (!auth) return;

  try {
    if (req.method === 'GET') {
      const state = await fetchAppState();
      return sendJson(res, 200, { ok: true, state });
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const state = body?.state;

      if (!state || typeof state !== 'object') {
        return sendJson(res, 400, { error: '缺少 state 物件' });
      }

      await saveAppState(state);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('state failed:', err);
    return sendJson(res, 500, { error: err.message || '資料讀寫失敗' });
  }
};