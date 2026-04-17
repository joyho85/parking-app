const crypto = require('crypto');
const { sendJson, getEnv, readRawBody } = require('./_common');

const APP_STATE_KEY = 'home_parking';

function getSignature(req) {
  return (
    req.headers['x-line-signature'] ||
    req.headers['X-Line-Signature'] ||
    req.headers['X-LINE-Signature'] ||
    ''
  );
}

function verifySignature(body, signature, channelSecret) {
  if (!body || !signature || !channelSecret) return false;

  const expected = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function replyMessage(replyToken, accessToken, text) {
  if (!replyToken || !accessToken || !text) return;

  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('LINE reply failed:', res.status, body);
  }
}

async function fetchLineProfile(userId, accessToken) {
  if (!userId) return null;

  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return null;
  return res.json();
}

async function getAppState() {
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
  return rows?.[0]?.state || {};
}

async function updateAppState(state) {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_state?key=eq.${APP_STATE_KEY}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
}

function normalizeAdminUsers(settings = {}) {
  const arr = Array.isArray(settings.lineAdminUsers) ? settings.lineAdminUsers : [];
  return arr.filter((x) => x && x.userId);
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const LINE_CHANNEL_SECRET = getEnv('LINE_CHANNEL_SECRET');
    const LINE_CHANNEL_ACCESS_TOKEN = getEnv('LINE_CHANNEL_ACCESS_TOKEN');

    const rawBody = await readRawBody(req);
    const signature = getSignature(req);

    if (!verifySignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
      return sendJson(res, 401, { error: 'LINE 簽章驗證失敗' });
    }

    let payload = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return sendJson(res, 400, { error: 'LINE webhook JSON 格式錯誤' });
    }

    const events = Array.isArray(payload.events) ? payload.events : [];

    for (const ev of events) {
      const replyToken = ev.replyToken;
      const userId = ev.source?.userId || '';

      if (ev.type === 'follow' && replyToken) {
        await replyMessage(
          replyToken,
          LINE_CHANNEL_ACCESS_TOKEN,
          '歡迎加入停車場管理通知服務。若你是管理員，請輸入 ADMIN-BIND 完成綁定。'
        );
        continue;
      }

      if (!(ev.type === 'message' && ev.message?.type === 'text' && replyToken)) {
        continue;
      }

      const text = String(ev.message.text || '').trim().toUpperCase();

      if (text !== 'ADMIN-BIND' && text !== 'ADMIN-UNBIND') {
        continue;
      }

      const appState = await getAppState();
      const settings = appState.settings || {};
      let adminUsers = normalizeAdminUsers(settings);

      if (text === 'ADMIN-BIND') {
        const profile = await fetchLineProfile(userId, LINE_CHANNEL_ACCESS_TOKEN);
        const existingIndex = adminUsers.findIndex((u) => u.userId === userId);
        const nextRecord = {
          userId,
          displayName: profile?.displayName || '',
          boundAt:
            existingIndex >= 0
              ? adminUsers[existingIndex].boundAt || new Date().toISOString()
              : new Date().toISOString(),
        };

        if (existingIndex >= 0) {
          adminUsers[existingIndex] = nextRecord;
        } else {
          adminUsers.push(nextRecord);
        }

        await updateAppState({
          ...appState,
          settings: {
            ...settings,
            lineAdminUsers: adminUsers,
          },
        });

        await replyMessage(
          replyToken,
          LINE_CHANNEL_ACCESS_TOKEN,
          `管理員綁定成功 ✅\n目前共有 ${adminUsers.length} 位管理員會收到到期提醒。`
        );
        continue;
      }

      if (text === 'ADMIN-UNBIND') {
        adminUsers = adminUsers.filter((u) => u.userId !== userId);

        await updateAppState({
          ...appState,
          settings: {
            ...settings,
            lineAdminUsers: adminUsers,
          },
        });

        await replyMessage(
          replyToken,
          LINE_CHANNEL_ACCESS_TOKEN,
          `已取消管理員通知 ❌\n目前剩餘 ${adminUsers.length} 位管理員。`
        );
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('line-webhook failed:', err);
    return sendJson(res, 500, { error: err.message || 'line-webhook 執行失敗' });
  }
};