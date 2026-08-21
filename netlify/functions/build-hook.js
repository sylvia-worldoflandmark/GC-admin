// GC 後台｜觸發官網重新建置（Netlify Function）
// 端點：POST /.netlify/functions/build-hook
//
// 為什麼要這一支：
//   官網每篇文章的靜態頁（blog/<網址代稱>/index.html）是「部署當下」由
//   build-blog.js 產生的。文章一發佈但沒有重新部署，那篇就沒有自己的
//   實體檔案，會落到 netlify.toml 的 /blog/* rewrite，送出去的是還沒
//   填過的模板 meta —— LINE、Facebook 的預覽爬蟲不會執行 JavaScript，
//   所以分享出去的標題與摘要會是列表頁的那一份。
//   後台在發佈／下架／刪除之後打這支，官網就會自己重建。
//
// 為什麼不讓前端直接打 Build Hook：
//   後台的登入是前端擋的，index.html 與 blog-admin.js 本身是公開檔案，
//   把 hook 網址寫在裡面等於公開它。別人拿到雖然讀不到任何資料，但可以
//   連續觸發重建，把 Netlify 每月的建置分鐘數燒完 —— 到時候你自己要
//   部署也會被卡住。所以網址只放在伺服器的環境變數裡，由這支代打，
//   而且先驗證呼叫者確實是已登入的後台使用者。
//
// 需要的環境變數（Netlify → Site configuration → Environment variables）：
//   NETLIFY_BUILD_HOOK   官網那個站的 Build Hook 網址（機密，只放這裡）
//   SUPABASE_URL / SUPABASE_ANON_KEY   驗證登入用（與其他 function 共用）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const H = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
const reply = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

// 同一分鐘內重複觸發沒有意義（Netlify 會排隊照跑，白白吃分鐘數）。
// Function 是無狀態的，但同一個容器會被重複使用，擋掉大部分的連點。
let LAST_FIRED = 0;
const COOLDOWN_MS = 60 * 1000;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: '只接受 POST' });

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  const HOOK = process.env.NETLIFY_BUILD_HOOK;

  if (!HOOK) {
    // 還沒設定就安靜回報，不要讓後台跳紅字 —— 沒有它文章照樣發佈得出去，
    // 只是要自己去 Netlify 手動 redeploy 一次。
    return reply(200, { ok: false, skipped: true, error: '伺服器尚未設定 NETLIFY_BUILD_HOOK' });
  }
  if (!SB_URL || !SB_KEY) {
    return reply(500, { ok: false, error: '伺服器未設定 SUPABASE_URL / SUPABASE_ANON_KEY' });
  }

  // ── 驗證呼叫者是已登入的後台使用者 ──
  const auth = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '');
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return reply(401, { ok: false, error: '未登入或登入已過期，請重新整理後台後再試' });
  try {
    const who = await fetch(SB_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + jwt },
      signal: AbortSignal.timeout(8000),
    });
    if (!who.ok) return reply(401, { ok: false, error: '登入已過期，請重新整理後台後再試' });
  } catch (e) {
    return reply(502, { ok: false, error: '無法驗證登入狀態：' + String((e && e.message) || e) });
  }

  const now = Date.now();
  if (now - LAST_FIRED < COOLDOWN_MS) {
    return reply(200, { ok: true, skipped: true, reason: 'cooldown',
                        wait: Math.ceil((COOLDOWN_MS - (now - LAST_FIRED)) / 1000) });
  }

  let reason = '';
  try { reason = String((JSON.parse(event.body || '{}') || {}).reason || '').slice(0, 80); } catch (e) {}

  try {
    const res = await fetch(HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // trigger_title 會顯示在 Netlify 的 deploy 清單上，之後看得出來是誰觸發的
      body: JSON.stringify({ trigger_title: '後台觸發：' + (reason || '文章異動') }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const txt = await res.text();
      return reply(502, { ok: false, error: 'Build Hook 回應 ' + res.status + '：' + txt.slice(0, 200) });
    }
    LAST_FIRED = now;
    return reply(200, { ok: true });
  } catch (e) {
    return reply(502, { ok: false, error: '無法觸發重建：' + String((e && e.message) || e) });
  }
};
