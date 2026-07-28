// GC 後台｜台灣銀行即期匯率 proxy（Netlify Function）
// 端點：https://<你的站台>.netlify.app/.netlify/functions/bot-rate
//
// 為什麼需要它：
//   台銀 rate.bot.com.tw 沒有開放 CORS，瀏覽器無法直接抓；改由「伺服器對伺服器」
//   抓取後加上 CORS 標頭回傳，前端就能穩定取得即時匯率，不必依賴不穩定的公用 proxy。
//
// 回傳：原始台銀 CSV（text/csv），沿用後台既有的 _parseBotCsv 解析。
// Node 18+（Netlify 預設）內建 global fetch。

const BOT_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';

const CORS = {
  'Access-Control-Allow-Origin': '*',          // 如需鎖來源，改成你的網域，例如 'https://gc-admin.netlify.app'
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async function (event) {
  // 預檢請求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  try {
    const res = await fetch(BOT_URL, {
      headers: {
        // 帶一個常見 UA，避免部分情況被拒
        'User-Agent': 'Mozilla/5.0 (compatible; GC-Admin-RateProxy/1.0)',
        'Accept': 'text/csv,*/*',
      },
      // Netlify Function 預設逾時 10 秒，這裡再保守設 8 秒
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { statusCode: 502, headers: CORS, body: 'BOT fetch failed: HTTP ' + res.status };
    }
    const csv = await res.text();
    // 粗略檢查是不是有效 CSV（台銀 CSV 首欄是幣別代碼，不會是 HTML）
    if (!csv || csv.trim().charAt(0) === '<') {
      return { statusCode: 502, headers: CORS, body: 'BOT returned unexpected content' };
    }
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type': 'text/csv; charset=utf-8',
        // 快取 30 分鐘，降低對台銀的請求量（即期匯率不需秒級更新）
        'Cache-Control': 'public, max-age=1800',
      },
      body: csv,
    };
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: 'proxy error: ' + ((e && e.message) || String(e)) };
  }
};
