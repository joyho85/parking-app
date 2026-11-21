const { createClient } = require('@supabase/supabase-js');
const { sendJson, getEnv } = require('./_common');

const APP_STATE_KEY = 'home_parking';
const BACKUP_TABLE = 'app_state_backups';
const KEEP_DAYS = 30;

function getSupabase() {
  return createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// 以台北時間計算日期（YYYY-MM-DD），避免伺服器使用 UTC 造成日期差一天。
function taipeiDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidState(state) {
  return (
    state &&
    typeof state === 'object' &&
    Array.isArray(state.tenants) &&
    Array.isArray(state.payments) &&
    state.settings &&
    typeof state.settings === 'object'
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('app_state')
      .select('state')
      .eq('key', APP_STATE_KEY)
      .maybeSingle();

    if (error) {
      throw new Error(`讀取 app_state 失敗：${error.message}`);
    }

    const state = data && data.state;

    // 結構異常或完全空白時不備份，避免用壞掉的資料取代好的備份。
    if (!isValidState(state)) {
      return sendJson(res, 500, { ok: false, error: 'app_state 結構異常，略過備份' });
    }
    if (state.tenants.length === 0 && state.payments.length === 0) {
      return sendJson(res, 200, { ok: true, skipped: true, message: '資料是空的，略過備份' });
    }

    const backupDate = taipeiDate(new Date());

    // 同一天只保留「第一次」的備份：重複執行不會覆蓋，
    // 這樣當天稍晚才發生的誤刪，不會把好的備份蓋掉。
    const { error: insertError } = await supabase
      .from(BACKUP_TABLE)
      .upsert(
        {
          backup_date: backupDate,
          state,
          tenants_count: state.tenants.length,
          payments_count: state.payments.length,
        },
        { onConflict: 'backup_date', ignoreDuplicates: true }
      );

    if (insertError) {
      throw new Error(`寫入備份失敗：${insertError.message}`);
    }

    // 備份成功後才清除舊備份（只保留最近 KEEP_DAYS 天）。
    const cutoff = taipeiDate(new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000));
    const { error: cleanError } = await supabase
      .from(BACKUP_TABLE)
      .delete()
      .lt('backup_date', cutoff);

    if (cleanError) {
      console.error('清除舊備份失敗：', cleanError.message);
    }

    const { count } = await supabase
      .from(BACKUP_TABLE)
      .select('backup_date', { count: 'exact', head: true });

    console.log(`backup ok, date=${backupDate}, tenants=${state.tenants.length}, payments=${state.payments.length}, kept=${count}`);

    // 回應只放筆數，不包含任何租戶資料。
    return sendJson(res, 200, {
      ok: true,
      backupDate,
      tenants: state.tenants.length,
      payments: state.payments.length,
      keptBackups: count,
    });
  } catch (err) {
    console.error('backup failed:', err);
    return sendJson(res, 500, { ok: false, error: err.message || 'backup 執行失敗' });
  }
};
