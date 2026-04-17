const { createClient } = require('@supabase/supabase-js');
const { sendJson, getEnv } = require('./_common');

const ALERT_DAYS = 7;
const APP_STATE_KEY = 'home_parking';

function getSupabase() {
  return createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function daysUntil(dateStr) {
  if (!dateStr) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;

  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return '未設定';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function buildMessage(list) {
  return [
    '🚗 停車場到期提醒',
    '',
    ...list.map(
      (item) =>
        `• ${item.name}（車位 ${item.spotNumber}）\n  到期日：${formatDate(item.contractEnd)}（剩 ${item.remainingDays} 天）`
    ),
  ].join('\n');
}

async function pushLineMessage(token, userId, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push 失敗：${res.status} ${body}`);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const LINE_CHANNEL_ACCESS_TOKEN = getEnv('LINE_CHANNEL_ACCESS_TOKEN');
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('app_state')
      .select('state')
      .eq('key', APP_STATE_KEY)
      .maybeSingle();

    if (error) {
      throw new Error(`讀取 app_state 失敗：${error.message}`);
    }

    const state = data?.state || {};
    const tenants = Array.isArray(state.tenants) ? state.tenants : [];
    const settings = state.settings || {};
    const adminUsers = Array.isArray(settings.lineAdminUsers)
      ? settings.lineAdminUsers.filter((u) => u && u.userId)
      : [];

    console.log(`line-reminder triggered, tenants=${tenants.length}, admins=${adminUsers.length}`);

    if (!adminUsers.length) {
      return sendJson(res, 200, {
        ok: true,
        message: '目前沒有綁定任何管理員，略過提醒。',
        checked: tenants.length,
        sentAdmins: 0,
        notifyCount: 0,
      });
    }

    const notifyList = [];
    const updatedTenants = [...tenants];

    for (let i = 0; i < tenants.length; i += 1) {
      const t = tenants[i];
      const remainingDays = daysUntil(t.contractEnd);

      const shouldNotify =
        t.tenantType !== 'family' &&
        t.contractEnd &&
        remainingDays !== null &&
        remainingDays >= 0 &&
        remainingDays <= ALERT_DAYS &&
        !t.expiryReminderSentAt;

      if (!shouldNotify) continue;

      notifyList.push({
        index: i,
        name: t.name,
        spotNumber: t.spotNumber,
        contractEnd: t.contractEnd,
        remainingDays,
      });
    }

    if (!notifyList.length) {
      return sendJson(res, 200, {
        ok: true,
        message: '目前沒有需要提醒的租戶。',
        checked: tenants.length,
        sentAdmins: 0,
        notifyCount: 0,
      });
    }

    const message = buildMessage(notifyList);

    let sentAdmins = 0;
    for (const admin of adminUsers) {
      try {
        await pushLineMessage(LINE_CHANNEL_ACCESS_TOKEN, admin.userId, message);
        sentAdmins += 1;
      } catch (err) {
        console.error(`推播給管理員 ${admin.displayName || admin.userId} 失敗:`, err.message);
      }
    }

    if (sentAdmins > 0) {
      const nowIso = new Date().toISOString();

      for (const item of notifyList) {
        updatedTenants[item.index] = {
          ...updatedTenants[item.index],
          expiryReminderSentAt: nowIso,
        };
      }

      const { error: updateError } = await supabase
        .from('app_state')
        .update({
          state: {
            ...state,
            tenants: updatedTenants,
          },
          updated_at: nowIso,
        })
        .eq('key', APP_STATE_KEY);

      if (updateError) {
        throw new Error(`寫回 app_state 失敗：${updateError.message}`);
      }
    }

    return sendJson(res, 200, {
      ok: true,
      message: `提醒完成，共通知 ${sentAdmins} 位管理員，涉及 ${notifyList.length} 位租戶。`,
      checked: tenants.length,
      sentAdmins,
      notifyCount: notifyList.length,
      notifyList: notifyList.map((t) => ({
        name: t.name,
        spotNumber: t.spotNumber,
        contractEnd: t.contractEnd,
        remainingDays: t.remainingDays,
      })),
    });
  } catch (err) {
    console.error('line-reminder failed:', err);
    return sendJson(res, 500, { error: err.message || 'line-reminder 執行失敗' });
  }
};