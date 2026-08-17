// GC 後台｜線上簽署 API（Netlify Function）
// 端點：/.netlify/functions/sign
//
//   GET  ?t=<token>            → 取回該張勞報單的「去識別化」內容供簽署頁顯示
//   POST { t, signature }      → 寫回簽名，狀態轉為 signed
//   POST { t, action:'mail', pdfBase64 } → 把簽署完成副本寄給所得人＋support@
//
// 安全模型：這支 Function 只用 anon 金鑰，真正的門檻在資料庫的兩支
// security definer 函式（sign_fetch / sign_submit）。匿名者對
// partner_payout_docs 沒有任何直接權限，只能憑 token 走那兩扇窗。
//
// 需要的環境變數：
//   SUPABASE_URL / SUPABASE_ANON_KEY   （非機密）
//   GAS_MAIL_URL / GAS_MAIL_TOKEN      （寄信用，與 send-mail 共用）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const H = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };
const reply = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

const SUPPORT = 'support@worldoflandmark.com';
const COMPANY = '世界之地標有限公司';

async function rpc(name, args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('伺服器未設定 SUPABASE_URL / SUPABASE_ANON_KEY');
  const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15000),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error('資料庫錯誤（' + res.status + '）：' + txt.slice(0, 300));
  try { return txt ? JSON.parse(txt) : null; } catch (e) { return null; }
}

// 與 send-mail.js 相同的寄信路徑。刻意複製而不共用模組 ——
// Netlify 對 functions 目錄下的檔案有「一個檔＝一支函式」的慣例，
// 拆共用模組會踩到打包規則，這 20 行的重複比較划算。
async function sendMail(payload) {
  const url = process.env.GAS_MAIL_URL, token = process.env.GAS_MAIL_TOKEN;
  if (!url || !token) return { ok: false, error: '伺服器未設定寄信參數' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, fromName: COMPANY, replyTo: SUPPORT, ...payload }),
      redirect: 'follow',
      // 帶 PDF 附件的請求光是上傳就要好幾秒，25 秒太緊 —— 逾時的話副本就永遠寄不出去，
      // 而且對方那頁只會看到一行紅字，後台完全無感。
      signal: AbortSignal.timeout(60000),
    });
    const raw = await res.text();
    try { return JSON.parse(raw); } catch (e) { return { ok: false, error: 'Apps Script 回應異常' }; }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function clientIp(event) {
  const h = event.headers || {};
  return String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '').split(',')[0].trim() || null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    // ── 取件 ──
    if (event.httpMethod === 'GET') {
      const t = (event.queryStringParameters || {}).t || '';
      if (!t || t.length < 16) return reply(400, { ok: false, error: 'invalid_token' });
      const rows = await rpc('sign_fetch', { p_token: t });
      const doc = Array.isArray(rows) ? rows[0] : rows;
      if (!doc) return reply(404, { ok: false, error: 'not_found' });
      const expired = doc.sign_expires_at && new Date(doc.sign_expires_at) < new Date();
      // payee_email 只給伺服器端寄副本用，不送到瀏覽器
      const safe = { ...doc }; delete safe.payee_email;
      return reply(200, { ok: true, doc: safe, expired: !!expired, signed: !!doc.signed_at });
    }

    if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'method_not_allowed' });

    let req;
    try { req = JSON.parse(event.body || '{}'); }
    catch (e) { return reply(400, { ok: false, error: 'bad_request' }); }

    const t = String(req.t || '');
    if (!t || t.length < 16) return reply(400, { ok: false, error: 'invalid_token' });

    // ── 寄簽署完成副本（附 PDF）──
    // 收件人不是由前端指定，而是資料庫裡這張單登記的所得人 Email，
    // 所以就算有人拿到 token 也只能寄給當事人自己，不會變成對外的寄信管道。
    if (req.action === 'mail') {
      const rows = await rpc('sign_fetch', { p_token: t });
      const doc = Array.isArray(rows) ? rows[0] : rows;
      if (!doc) return reply(404, { ok: false, error: 'not_found' });
      if (!doc.signed_at) return reply(409, { ok: false, error: 'not_signed_yet' });

      // 收件人一律取資料庫裡登記的所得人 Email，前端指定不了
      const to = String(doc.payee_email || '').trim();
      const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
      const b64 = typeof req.pdfBase64 === 'string' ? req.pdfBase64 : '';
      if (b64.length > 4 * 1024 * 1024) return reply(413, { ok: false, error: 'pdf_too_large' });

      const html =
        '<div style="font-family:-apple-system,\'Segoe UI\',\'Noto Sans TC\',sans-serif;font-size:14px;line-height:1.8;color:#1f2328;">' +
        (doc.payee_name || '') + ' 您好：<br><br>' +
        '您已完成勞務報酬單 <b>' + (doc.doc_no || '') + '</b> 的線上簽署，附件是這份文件的 PDF 副本，請留存。<br><br>' +
        '支領金額：NT$ ' + Number(doc.amount_untaxed || 0).toLocaleString('en-US') + '<br>' +
        '實際支付：NT$ ' + Number(doc.amount_payable || 0).toLocaleString('en-US') + '<br><br>' +
        '款項將依約定時程匯入您指定的帳戶。<br>' +
        '<div style="margin-top:22px;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:#8b909a;">' +
        COMPANY + '　' + SUPPORT + '<br>本信件由系統發送，如有疑問請直接回覆此信。</div></div>';

      const attachments = b64
        ? [{ filename: '勞務報酬單_' + (doc.doc_no || '') + '.pdf', mimeType: 'application/pdf', base64: b64 }]
        : [];

      // 寄送結果一定要留痕：失敗時後台才看得到，不然只有簽的人看到一行紅字。
      // sign_log_notice 是 security definer 函式；若資料庫還沒建這支，靜默略過即可。
      const logNotice = async (result, recipient) => {
        try { await rpc('sign_log_notice', { p_token: t, p_result: result, p_recipient: recipient || null }); }
        catch (e) { /* 沒建 RPC 或寫入失敗都不該影響簽署流程 */ }
      };

      const results = [];
      if (okEmail) {
        results.push(await sendMail({
          to, bcc: SUPPORT,
          subject: '【' + COMPANY + '】勞務報酬單 ' + (doc.doc_no || '') + ' 簽署完成副本',
          text: '您已完成線上簽署，附件是 PDF 副本，請留存。',
          html, attachments, kind: '簽署完成副本',
        }));
      } else {
        // 建檔沒留 Email：至少讓 support@ 收到一份，不要靜默掉
        results.push(await sendMail({
          to: SUPPORT,
          subject: '【簽署完成・無所得人 Email】' + (doc.doc_no || ''),
          text: (doc.payee_name || '') + ' 已完成簽署，但建檔沒有 Email，副本無法寄給對方。',
          html, attachments, kind: '簽署完成副本',
        }));
      }
      const mailed = !!(results[0] && results[0].ok === true);
      await logNotice(
        mailed ? 'ok' : ('failed: ' + ((results[0] && results[0].error) || '未知錯誤')),
        okEmail ? to : SUPPORT
      );
      return reply(200, { ok: true, mailed, detail: results[0] });
    }

    // ── 回簽 ──
    const sig = String(req.signature || '');
    if (!/^data:image\/png;base64,/.test(sig)) return reply(400, { ok: false, error: 'bad_signature' });
    if (sig.length > 500000) return reply(413, { ok: false, error: 'too_large' });

    const out = await rpc('sign_submit', {
      p_token: t,
      p_sig: sig,
      p_ip: clientIp(event),
      p_ua: String((event.headers || {})['user-agent'] || '').slice(0, 400),
    });
    if (!out || out.ok !== true) {
      return reply(409, { ok: false, error: (out && out.error) || 'submit_failed' });
    }
    return reply(200, out);

  } catch (err) {
    return reply(500, { ok: false, error: String((err && err.message) || err) });
  }
};
