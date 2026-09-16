// GC 後台｜從 Notion 連結匯入一篇文章（Netlify Function）
// 端點：POST /.netlify/functions/notion-import
//
// 為什麼要這一支：
//   Notion 的公開分享頁（*.notion.site）是前端渲染的，伺服器直接抓網址
//   回來的只有一個空殼（實測過：HTML 裡只有 meta 與「JavaScript must be
//   enabled」那行，內容一個字都沒有）。所以連結只拿來抽 page id，
//   內容一律走官方 API。官方 API 回的是結構化 JSON，比 .md 匯出與剪貼簿
//   HTML 都準 —— 表格就是表格、摺疊就是摺疊、巢狀清單有真的層級、
//   重點框的 icon 與標題本來就是分開的欄位，不必再猜。
//
// 為什麼不讓前端直接打 api.notion.com：
//   ① Notion API 沒有給瀏覽器用的 CORS，前端打不到。
//   ② token 是機密，寫進 index.html／blog-admin.js 等於公開（那兩個檔
//      本身是公開可讀的靜態檔）。所以放環境變數，由這支代打，
//      而且先驗證呼叫者確實是已登入的後台使用者（比照 build-hook.js）。
//
// ⚠ 匯入是「一次性的搬運」，不是同步（sylvia 2026-09-16 定案）：
//   進來之後那篇就完全屬於後台，跟 Notion 斷開。所以這裡不回傳、也不要求
//   前端保存 page id，更沒有重新同步或變更比對。
//
// ⚠ 圖片：Notion 給的是「約 1 小時到期的簽名網址」，不能直接存進文章。
//   但那些網址沒有 CORS 標頭，瀏覽器 fetch 讀不到位元組，所以由這支代抓
//   （action:'image'），前端再上傳到 Supabase Storage。一張一張抓，
//   避免一次把整篇的圖塞進同一個 function 呼叫裡撞到執行時間上限。
//
// 需要的環境變數（Netlify → Site configuration → Environment variables）：
//   NOTION_TOKEN                       Notion internal integration 的 token（機密）
//   SUPABASE_URL / SUPABASE_ANON_KEY   驗證登入用（與其他 function 共用）
//
// ⚠ 這支在 file:// 下叫不到（本機直接開 index.html 時沒有伺服器）。
//   要測請用 `netlify dev`，或部署上去測。

const NOTION_VER = '2022-06-28';
const API = 'https://api.notion.com/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const H = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
const reply = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

// 整篇的硬上限。Netlify Function 有執行時間限制，文章再長也不該無限抓下去。
const MAX_BLOCKS = 500;
const MAX_DEPTH = 3;
const BUDGET_MS = 8000;

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* Notion 的色名 → 色碼。只吃得到文字色與底色兩種（跟官網的白名單一致）。 */
const NC = {
  gray:'#787774', brown:'#9F6B53', orange:'#D9730D', yellow:'#CB912F', green:'#448361',
  blue:'#337EA9', purple:'#9065B0', pink:'#C14C8A', red:'#D44C47',
};
const NBG = {
  gray:'#F1F1EF', brown:'#F4EEEE', orange:'#FBECDD', yellow:'#FBF3DB', green:'#EDF3EC',
  blue:'#E7F3F8', purple:'#F6F3F9', pink:'#FAF1F5', red:'#FDEBEC',
};

/* rich_text → 後台認得的行內 HTML（白名單：b i u s a code span[color]） */
function rich(rt){
  if (!Array.isArray(rt) || !rt.length) return '';
  return rt.map(t => {
    let h = esc(t.plain_text == null ? '' : t.plain_text).replace(/\n/g, '<br>');
    const a = t.annotations || {};
    if (a.code) h = '<code>' + h + '</code>';
    if (a.bold) h = '<b>' + h + '</b>';
    if (a.italic) h = '<i>' + h + '</i>';
    if (a.underline) h = '<u>' + h + '</u>';
    if (a.strikethrough) h = '<s>' + h + '</s>';
    const c = a.color || 'default';
    if (c !== 'default') {
      const bg = /_background$/.test(c);
      const key = c.replace(/_background$/, '');
      const css = bg ? (NBG[key] && 'background-color:' + NBG[key]) : (NC[key] && 'color:' + NC[key]);
      if (css) h = '<span style="' + css + '">' + h + '</span>';
    }
    const url = (t.text && t.text.link && t.text.link.url) || t.href;
    if (url && /^https?:\/\//i.test(url)) h = '<a href="' + esc(url) + '">' + h + '</a>';
    return h;
  }).join('');
}
const plainOf = rt => (Array.isArray(rt) ? rt.map(t => t.plain_text || '').join('') : '');

/* 框開頭的 emoji 決定要「重點框」還是「提醒框」—— 規則與 blog-admin.js 的
   BLOG_WARN_EMO 一致，改一邊要改兩邊。 */
const WARN_EMO = ['⚠','🚨','❗','❕','‼','⛔',
                  '🛑','🔴','❌','🔥','☢','☣','💀'];
function calStyle(emo, title){
  if (emo && WARN_EMO.some(e => emo.indexOf(e) === 0)) return 'warn';
  if (/注意|警告|提醒|小心|風險|危險|禁止/.test(String(title || ''))) return 'warn';
  return 'note';
}

async function nfetch(path, token, ms){
  const res = await fetch(API + path, {
    headers: { Authorization: 'Bearer ' + token, 'Notion-Version': NOTION_VER },
    signal: AbortSignal.timeout(ms || 8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error('Notion API ' + res.status);
    err.status = res.status;
    err.body = body.slice(0, 300);
    throw err;
  }
  return res.json();
}

/* 把一頁（或一個區塊）底下的子區塊全部抓下來，含分頁與遞迴 */
async function children(id, token, depth, state){
  if (depth > MAX_DEPTH || state.count >= MAX_BLOCKS || Date.now() > state.deadline) return [];
  const out = [];
  let cursor = null;
  do {
    const q = '?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : '');
    const page = await nfetch('/blocks/' + id + '/children' + q, token);
    for (const b of (page.results || [])) {
      state.count++;
      if (state.count > MAX_BLOCKS) { state.truncated = true; break; }
      if (b.has_children) b._kids = await children(b.id, token, depth + 1, state);
      out.push(b);
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && state.count < MAX_BLOCKS && Date.now() < state.deadline);
  if (cursor) state.truncated = true;
  return out;
}

const INBOX = ['paragraph','heading','list','todo','quote'];   // 框裡面只放這幾種

/* Notion 區塊陣列 → 後台的區塊陣列 */
function convert(list, opt){
  const o = opt || {};
  const out = [];
  let i = 0;

  const pushList = (style, items) => {
    if (items.length) out.push(style === 'todo'
      ? { type:'todo', items }
      : { type:'list', style, items });
  };

  while (i < list.length) {
    const b = list[i];
    const t = b.type;
    const d = b[t] || {};

    // 連續的清單項目收成同一個區塊；子項用 lv 標層級（後台只做兩層）
    if (t === 'bulleted_list_item' || t === 'numbered_list_item' || t === 'to_do') {
      const style = t === 'numbered_list_item' ? 'ol' : (t === 'to_do' ? 'todo' : 'ul');
      const items = [];
      const after = [];
      const isLi = k => /_list_item$/.test(k.type) || k.type === 'to_do';
      while (i < list.length && list[i].type === t) {
        const cur = list[i], cd = cur[t] || {};
        items.push(rich(cd.rich_text));
        const kids = cur._kids || [];
        // 子項只吃同樣是清單項目的（後台的清單裡放不下段落）；
        // 其餘的小孩轉好接在整份清單後面，不要弄丟
        kids.filter(isLi).forEach(k => items.push({ html: rich((k[k.type] || {}).rich_text), lv: 1 }));
        const other = kids.filter(k => !isLi(k));
        if (other.length) after.push(...convert(other, o));
        i++;
      }
      pushList(style, items.filter(x => (typeof x === 'string' ? x : x.html) !== ''));
      out.push(...after);
      continue;
    }

    switch (t) {
      case 'paragraph': {
        const h = rich(d.rich_text);
        if (h) out.push({ type:'paragraph', html:h });
        break;
      }
      case 'heading_1':
      case 'heading_2':
      case 'heading_3': {
        // 後台只有 H2／H3 兩級，H1 一律降成 H2
        const lv = t === 'heading_3' ? 3 : 2;
        const h = rich(d.rich_text), p = plainOf(d.rich_text);
        if (p) out.push({ type:'heading', level:lv, text:p, html:h });
        // Notion 的標題可以是可摺疊的，子內容接在下面
        if (d.is_toggleable && b._kids) out.push(...convert(b._kids, o));
        break;
      }
      case 'quote': {
        const h = rich(d.rich_text), p = plainOf(d.rich_text);
        if (p) out.push({ type:'quote', text:p, html:h, source:'' });
        // 引言底下掛的子區塊：後台的引言只有一行，子區塊接在後面，不併進去
        if (b._kids) out.push(...convert(b._kids, o));
        break;
      }
      case 'callout': {
        const emo = (d.icon && d.icon.type === 'emoji') ? d.icon.emoji : '';
        const body = rich(d.rich_text);
        // Notion 的 callout 內文就是框標題那一行；icon 與標題本來就是分開的欄位，
        // 不像剪貼簿 HTML 要自己猜哪一段是 emoji
        const title = (emo ? esc(emo) + (body ? ' ' : '') : '') + body;
        const all = convert(b._kids || [], o);
        const kids = all.filter(x => INBOX.indexOf(x.type) >= 0);
        const rest = all.filter(x => INBOX.indexOf(x.type) < 0);
        if (title || kids.length) {
          out.push({ type:'callout', style: calStyle(emo, plainOf(d.rich_text)), title, blocks: kids });
        }
        out.push(...rest);       // 框裡放不下的（圖片、表格…）接在框後面，不要弄丟
        break;
      }
      case 'toggle': {
        const all2 = convert(b._kids || [], o);
        const kids = all2.filter(x => INBOX.indexOf(x.type) >= 0);
        const rest = all2.filter(x => INBOX.indexOf(x.type) < 0);
        const title = rich(d.rich_text);
        if (title || kids.length) out.push({ type:'toggle', title, open:false, blocks:kids });
        out.push(...rest);
        break;
      }
      case 'divider':
        out.push({ type:'divider' });
        break;
      case 'code': {
        // 後台沒有程式碼區塊，整段包成一個行內 code（與 .md 那條路徑一致）
        const p = plainOf(d.rich_text);
        if (p) out.push({ type:'paragraph', html:'<code>' + esc(p).replace(/\n/g, '<br>') + '</code>' });
        break;
      }
      case 'image': {
        const url = (d.file && d.file.url) || (d.external && d.external.url) || '';
        if (url) out.push({ type:'image', url, caption: plainOf(d.caption), source:'',
                            _notion: !!(d.file && d.file.url) });
        break;
      }
      case 'video':
      case 'embed':
      case 'bookmark': {
        const url = (d.external && d.external.url) || d.url || '';
        if (!url) break;
        if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) {
          out.push({ type:'video', url, thumb:'', caption: plainOf(d.caption), source:'' });
        } else {
          out.push({ type:'paragraph', html:'<a href="' + esc(url) + '">' + esc(url) + '</a>' });
        }
        break;
      }
      case 'table': {
        const rows = (b._kids || []).filter(r => r.type === 'table_row')
          .map(r => ((r.table_row || {}).cells || []).map(c => rich(c)));
        if (rows.length) {
          // 有表頭欄就把第一列當表頭；沒有的話後台也是拿第一列當表頭
          const head = rows.shift();
          out.push({ type:'table', head, rows });
        }
        break;
      }
      case 'column_list':
      case 'column':
      case 'synced_block':
        // 多欄與同步區塊沒有對應型別，攤平成上下排列，內容不會掉
        out.push(...convert(b._kids || [], o));
        break;
      case 'equation': {
        const p = d.expression || '';
        if (p) out.push({ type:'paragraph', html:'<code>' + esc(p) + '</code>' });
        break;
      }
      // table_of_contents / breadcrumb / child_page / child_database / link_to_page
      // 這幾種在文章裡沒有意義，直接略過
      default:
        break;
    }
    i++;
  }
  return out;
}

/* Notion 網址 → page id。notion.so / notion.site、有沒有標題前綴、
   帶不帶 ?pvs= 都一樣，取路徑裡最後一個 32 碼或帶破折號的 UUID。 */
function pageIdOf(input) {
  const s = String(input || '').trim();
  const path = s.split('?')[0].split('#')[0];
  const all = path.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi);
  if (!all || !all.length) return '';
  return all[all.length - 1].replace(/-/g, '');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { ok:false, error:'只接受 POST' });

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  const TOKEN = process.env.NOTION_TOKEN;

  if (!TOKEN) {
    return reply(503, { ok:false, error:
      '這個站還沒設定 NOTION_TOKEN。請到 Netlify → Site configuration → Environment variables 加上它。' });
  }

  // ── 驗證呼叫者是已登入的後台使用者（比照 build-hook.js）──
  const auth = String((event.headers || {}).authorization || (event.headers || {}).Authorization || '');
  const jwt = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return reply(401, { ok:false, error:'未登入或登入已過期，請重新整理後台後再試' });
  try {
    const who = await fetch(SB_URL.replace(/\/$/, '') + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + jwt },
      signal: AbortSignal.timeout(8000),
    });
    if (!who.ok) return reply(401, { ok:false, error:'登入已過期，請重新整理後台後再試' });
  } catch (e) {
    return reply(502, { ok:false, error:'無法驗證登入狀態：' + String((e && e.message) || e) });
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (e) {}

  // ── 代抓一張圖（Notion 的簽名網址沒有 CORS，瀏覽器讀不到位元組）──
  if (body.action === 'image') {
    const url = String(body.url || '');
    if (!/^https:\/\//i.test(url)) return reply(400, { ok:false, error:'圖片網址不正確' });
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return reply(502, { ok:false, error:'抓圖失敗（' + r.status + '），簽名網址可能已過期' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 9 * 1024 * 1024) return reply(413, { ok:false, error:'這張圖超過 9MB，請自己壓過再手動上傳' });
      return reply(200, {
        ok: true,
        contentType: r.headers.get('content-type') || 'image/jpeg',
        data: buf.toString('base64'),
      });
    } catch (e) {
      return reply(502, { ok:false, error:'抓圖失敗：' + String((e && e.message) || e) });
    }
  }

  // ── 抓一整頁 ──
  const pageId = pageIdOf(body.url || body.pageId || '');
  if (!pageId) {
    return reply(400, { ok:false, error:'這不像 Notion 的連結。請直接從 Notion 複製頁面網址貼過來。' });
  }

  const state = { count:0, truncated:false, deadline: Date.now() + BUDGET_MS };
  let title = '';
  try {
    const page = await nfetch('/pages/' + pageId, TOKEN);
    const props = page.properties || {};
    const tp = Object.keys(props).find(k => props[k] && props[k].type === 'title');
    if (tp) title = plainOf(props[tp].title);
  } catch (e) {
    if (e.status === 404) {
      return reply(404, { ok:false, error:
        '讀不到這一頁。多半是還沒把它分享給匯入用的連線 —— 在 Notion 打開該頁（或它的母頁／資料庫）→ 右上「⋯」→ 連線 → 加入 GC 的 integration，母層加一次底下的子頁都會生效。' });
    }
    if (e.status === 401) return reply(502, { ok:false, error:'NOTION_TOKEN 不正確或已失效，請到 Netlify 重新設定。' });
    return reply(502, { ok:false, error:'讀取頁面失敗：' + String((e && e.message) || e) + (e.body ? '｜' + e.body : '') });
  }

  let blocks;
  try {
    const raw = await children(pageId, TOKEN, 1, state);
    blocks = convert(raw, {});
  } catch (e) {
    return reply(502, { ok:false, error:'讀取內容失敗：' + String((e && e.message) || e) + (e.body ? '｜' + e.body : '') });
  }

  return reply(200, {
    ok: true,
    title,
    blocks,
    truncated: state.truncated,
    images: blocks.filter(b => b.type === 'image' && b._notion).length,
  });
};
