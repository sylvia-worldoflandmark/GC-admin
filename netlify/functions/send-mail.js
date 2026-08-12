// GC 後台｜寄信 proxy（Netlify Function）
// 端點：https://admin-worloflandmark.netlify.app/.netlify/functions/send-mail
//
// 流程：後台瀏覽器 → 這支 Function → Google Apps Script → Gmail（support@worldoflandmark.com 身分寄出）
//
// 為什麼要多這一層，不讓瀏覽器直接打 Apps Script：
//   1. 共用密鑰 GAS_MAIL_TOKEN 留在伺服器端，不會出現在前端原始碼裡
//   2. 伺服器對伺服器沒有 CORS 限制，可以完整讀到 Apps Script 的回應
//      （官網表單那支被迫用 mode:'no-cors'，寄成功或失敗完全看不到，這裡沒有這個問題）
//
// 需要的環境變數（Netlify → admin-worloflandmark → Site configuration → Environment variables）：
//   GAS_MAIL_URL    Apps Script 部署後的 /exec 網址
//   GAS_MAIL_TOKEN  自訂共用密鑰，必須與 Apps Script 的 Script Property「TOKEN」完全一致
//
// Node 18+（Netlify 預設）內建 fetch / AbortSignal.timeout。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

// Netlify Function 的請求上限是 6MB，base64 會膨脹約 33%，抓 4MB 當附件總量的安全線
const MAX_ATTACH_B64 = 4 * 1024 * 1024;

function reply(statusCode, obj) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(obj) };
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

  const GAS_URL = process.env.GAS_MAIL_URL;
  const GAS_TOKEN = process.env.GAS_MAIL_TOKEN;
  if (!GAS_URL || !GAS_TOKEN) {
    return reply(500, { ok: false, error: '伺服器未設定寄信參數（GAS_MAIL_URL / GAS_MAIL_TOKEN）' });
  }

  // ── 必須是已登入的後台使用者 ──
  // 沒有這一段，任何人知道這個網址就能用 support@ 的名義寄信給任何人。
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY) {
    return reply(500, { ok: false, error: '伺服器未設定 SUPABASE_URL / SUPABASE_ANON_KEY' });
  }
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

  let req;
  try {
    req = JSON.parse(event.body || '{}');
  } catch (e) {
    return reply(400, { ok: false, error: '請求格式錯誤' });
  }

  // ── 基本檢查：寧可在這裡擋下來，也不要送出一封寄不到的信 ──
  const to = String(req.to || '').trim();
  if (!isEmail(to)) return reply(400, { ok: false, error: '收件人 Email 格式不正確' });
  const subject = String(req.subject || '').trim();
  if (!subject) return reply(400, { ok: false, error: '主旨不可空白' });
  if (!req.html && !req.text) return reply(400, { ok: false, error: '信件內容不可空白' });
  for (const k of ['cc', 'bcc', 'replyTo']) {
    const v = String(req[k] || '').trim();
    if (v && !v.split(',').every((x) => isEmail(x))) {
      return reply(400, { ok: false, error: k + ' 的 Email 格式不正確' });
    }
  }

  const attachments = Array.isArray(req.attachments) ? req.attachments : [];
  let b64Total = 0;
  for (const a of attachments) {
    if (!a || typeof a.base64 !== 'string' || !a.filename) {
      return reply(400, { ok: false, error: '附件格式不正確' });
    }
    b64Total += a.base64.length;
  }
  if (b64Total > MAX_ATTACH_B64) {
    return reply(413, { ok: false, error: '附件太大（上限約 3MB），請壓縮後再寄' });
  }

  const payload = {
    token: GAS_TOKEN,
    to,
    cc: req.cc || '',
    bcc: req.bcc || '',
    replyTo: req.replyTo || '',
    fromName: req.fromName || '世界之地標有限公司',
    subject,
    text: req.text || '',
    html: req.html || '',
    attachments,
    kind: req.kind || '',
  };

  let res, raw;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      // Apps Script 的 doPost 讀 e.postData.contents，用 text/plain 送 JSON 最穩
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow', // Apps Script 會 302 轉到 script.googleusercontent.com
      signal: AbortSignal.timeout(25000),
    });
    raw = await res.text();
  } catch (err) {
    const msg = err && err.name === 'TimeoutError' ? 'Apps Script 逾時未回應' : String((err && err.message) || err);
    return reply(502, { ok: false, error: '無法連線寄信服務：' + msg });
  }

  // Apps Script 正常會回 JSON；回 HTML 幾乎都是部署權限沒開或網址貼錯
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const hint = /accounts\.google\.com|Google 帳戶|Sign in/i.test(raw)
      ? 'Apps Script 部署的存取權限不是「Anyone」，或 GAS_MAIL_URL 貼到了編輯器網址而非 /exec 網址'
      : 'Apps Script 回應不是 JSON（HTTP ' + res.status + '）';
    return reply(502, { ok: false, error: hint });
  }

  if (!data.ok) {
    return reply(502, { ok: false, error: data.error || 'Apps Script 回報寄送失敗' });
  }

  return reply(200, {
    ok: true,
    sentAt: data.sentAt || new Date().toISOString(),
    remainingQuota: typeof data.remainingQuota === 'number' ? data.remainingQuota : null,
  });
};
