// GC 後台｜台灣銀行即期匯率 proxy（Netlify Function）— 強化版
// 端點：https://<你的站台>.netlify.app/.netlify/functions/bot-rate
//
// 策略：伺服器端「並行」嘗試多個來源，第一個成功即回傳：
//   1) 直接抓台銀 flcsv（帶瀏覽器式標頭）
//   2) 若台銀擋雲端 IP／逾時，改由數個公用 proxy 代抓（伺服器對伺服器，較穩）
// 全部失敗才回 502，並在內文列出各來源失敗原因，方便診斷。
// 回傳原始台銀 CSV（text/csv），沿用後台既有 _parseBotCsv 解析。
// Node 18+（Netlify 預設）內建 fetch / Promise.any / AbortSignal.timeout。

const BOT_URL = 'https://rate.bot.com.tw/xrt/flcsv/0/day';

const SOURCES = [
  { name: 'bot-direct', url: BOT_URL, direct: true },
  { name: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(BOT_URL) },
  { name: 'codetabs',   url: 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(BOT_URL) },
  { name: 'corsproxy',  url: 'https://corsproxy.io/?url=' + encodeURIComponent(BOT_URL) },
  { name: 'thingproxy', url: 'https://thingproxy.freeboard.io/fetch/' + BOT_URL },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function grab(src) {
  const headers = src.direct
    ? {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        'Referer': 'https://rate.bot.com.tw/xrt?Lang=zh-TW',
      }
    : { 'User-Agent': 'Mozilla/5.0 (compatible; GC-Admin-RateProxy/2.0)' };
  const res = await fetch(src.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(src.name + ': HTTP ' + res.status);
  let txt = await res.text();
  txt = txt.replace(/^﻿/, ''); // 去 BOM
  if (!txt || txt.trim().charAt(0) === '<') throw new Error(src.name + ': non-csv/html');
  if (!/USD|JPY/.test(txt)) throw new Error(src.name + ': no-currency');
  return txt;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  try {
    const csv = await Promise.any(SOURCES.map(grab));
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=1800' },
      body: csv,
    };
  } catch (agg) {
    const errs = (agg && agg.errors ? agg.errors : [agg]).map(function (e) { return (e && e.message) || String(e); });
    return { statusCode: 502, headers: CORS, body: '所有來源皆失敗：\n' + errs.join('\n') };
  }
};
