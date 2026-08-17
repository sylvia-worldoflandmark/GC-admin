/* ═══════════════════════════════════════════════════════════════════════
   GC 後台｜部落格文章模組
   version 1.0  ·  2026-08-03

   依賴 index.html 主程式的全域變數與函式：
     sb / currentUser / _esc / _toast / _dt / buildPageBtns / renderEmptyState

   ⚠ 本檔必須放在 index.html 最後一個 </script> 之後、</body> 之前，
      否則上面那些全域變數都還沒宣告。

   命名規則：CSS class 一律 blog- 前綴、JS 全域一律 blog 開頭，
            避免與主檔既有的 .sel .chk .card .active .badge … 撞名。
   ═══════════════════════════════════════════════════════════════════════ */

/* ── 對主檔工具的安全代理（主檔若改名也不會整個壞掉） ────────────── */
function bgEsc(s){
  if (typeof _esc === 'function') return _esc(s);
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c];
  });
}
function bgToast(msg, kind){
  if (typeof _toast === 'function') return _toast(msg, kind);
  alert(msg);
}
function bgDt(v){
  if (v == null || v === '') return '—';
  if (typeof _dt === 'function') return _dt(v);
  try { return new Date(v).toLocaleString('zh-TW'); } catch(e){ return String(v); }
}
function bgDate(v){
  if (v == null || v === '') return '—';
  var s = bgDt(v);
  return String(s).split(' ')[0];
}
function bgIsAdmin(){
  return !!(typeof currentUser !== 'undefined' && currentUser && String(currentUser.role) === '0');
}
function bgMe(){
  return (typeof currentUser !== 'undefined' && currentUser && currentUser.full_name) || '';
}

/* ── 狀態設定 ─────────────────────────────────────────────────────── */
var BLOG_STATUS = {
  draft:       { label:'草稿',   cls:'blog-bd-blue'  },
  published:   { label:'發佈中', cls:'blog-bd-green' },
  unpublished: { label:'已下架', cls:'blog-bd-amber' },
  archived:    { label:'封存',   cls:'blog-bd-gray'  }
};
var BLOG_RATIOS = {
  '16:9': { canvas:'1920 × 1080 px', min:'1280 × 720 px',  pad:'56.25%' },
  '4:5':  { canvas:'1080 × 1350 px', min:'800 × 1000 px',  pad:'125%'   },
  '1:1':  { canvas:'1080 × 1080 px', min:'800 × 800 px',   pad:'100%'   }
};
var BLOG_SITE = 'https://worldoflandmark.com';
var BLOG_BUCKET = 'blog-images';
var BLOG_MAX_MB = 5;
var BLOG_MAX_PX = 2000;

/* ── 模組狀態 ─────────────────────────────────────────────────────── */
var BLOG_DB   = [];      // 全部文章
var BLOG_CATS = [];      // 分類
var BLOG_TAGS = [];      // 既有標籤（下拉提示用）
var blogPage = 1;
var blogSearch = '';
var blogTab = 'all';
var BLOG_EDIT = null;    // 編輯中的文章
var BLOG_DIRTY = false;

/* ═══ 樣式（只注入一次） ═══════════════════════════════════════════ */
function blogInjectStyle(){
  if (document.getElementById('blog-admin-style')) return;
  var css = ''
  + '.blog-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:18px;overflow-x:auto}'
  + '.blog-tab{padding:10px 16px;font-size:13px;color:var(--text-dim);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;display:flex;align-items:center;gap:7px;transition:.15s}'
  + '.blog-tab:hover{color:var(--text-mid)}'
  + '.blog-tab.blog-on{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}'
  + '.blog-tab .blog-c{background:#f3f4f6;color:var(--text-dim);font-size:11px;padding:1px 7px;border-radius:20px;font-weight:600}'
  + '.blog-tab.blog-on .blog-c{background:#dbeafe;color:var(--accent)}'
  + '.blog-bd{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11.5px;font-weight:600}'
  + '.blog-bd i{width:5px;height:5px;border-radius:50%;background:currentColor;display:block}'
  + '.blog-bd-green{background:#dcfce7;color:#16a34a}.blog-bd-blue{background:#dbeafe;color:#2563eb}'
  + '.blog-bd-amber{background:#fef3c7;color:#d97706}.blog-bd-gray{background:#f3f4f6;color:rgba(17,24,39,.45)}'
  + '.blog-pin{background:#fff7ed;color:#ea580c;border-radius:4px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:6px;white-space:nowrap;display:inline-block}'
  + '.blog-th{width:54px;height:38px;border-radius:6px;flex:none;background:#e9ecf1 center/cover no-repeat;display:inline-block;vertical-align:middle}'
  + '.blog-name{color:var(--text);font-weight:500;font-size:13.5px;line-height:1.55;display:block;max-width:360px;white-space:normal}'
  + '.blog-slug{font-family:Inter,monospace;font-size:11px;color:var(--text-dim);margin-top:3px;display:block}'
  + '.blog-rowtags{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}'
  + '.blog-rowtags span{border:1px solid var(--border);border-radius:100px;padding:0 7px;font-size:10.5px;color:var(--text-dim)}'
  + '.blog-ops{display:flex;gap:3px;justify-content:flex-end}'
  /* 列表每一列的「管理」按鈕 + 動作選單 */
  + '.blog-rowbtn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12.5px;font-weight:500;font-family:inherit;cursor:pointer;background:#fff;color:var(--text-mid);border:1px solid var(--border);transition:.15s;white-space:nowrap}'
  + '.blog-rowbtn:hover{background:#f7f8fa;color:var(--accent);border-color:#c7d2fe}'
  + '.blog-rowbtn.blog-on{background:#eff4ff;color:var(--accent);border-color:#c7d2fe}'
  + '.blog-rowbtn svg{transition:transform .15s}'
  + '.blog-rowbtn.blog-on svg{transform:rotate(180deg)}'
  + '.blog-rmenu{position:fixed;z-index:9998;background:#fff;border:1px solid var(--border);border-radius:11px;box-shadow:0 14px 40px rgba(0,0,0,.18);padding:6px;display:none;width:248px;max-height:min(76vh,560px);overflow-y:auto}'
  + '.blog-rmenu.blog-on{display:block}'
  + '.blog-rmh{padding:6px 10px 9px;font-size:11px;color:var(--text-dim);border-bottom:1px solid var(--border);margin-bottom:5px;line-height:1.5}'
  + '.blog-rmh b{display:block;color:var(--text);font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}'
  + '.blog-rmi{width:100%;display:flex;align-items:flex-start;gap:9px;padding:8px 10px;border:0;background:transparent;border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;color:var(--text)}'
  + '.blog-rmi:hover{background:#f4f5f7}'
  + '.blog-rmi i{flex:none;width:16px;height:16px;display:grid;place-items:center;color:var(--text-dim);margin-top:1px}'
  + '.blog-rmi:hover i{color:var(--accent)}'
  + '.blog-rmt{min-width:0}'
  + '.blog-rmt b{font-size:12.5px;font-weight:500;display:block;line-height:1.5}'
  + '.blog-rmt em{font-size:11px;font-style:normal;color:var(--text-dim);display:block;line-height:1.45;margin-top:1px}'
  + '.blog-rmi.blog-dg:hover{background:#fef2f2}'
  + '.blog-rmi.blog-dg:hover i,.blog-rmi.blog-dg:hover b{color:var(--danger)}'
  + '.blog-rmi.blog-ok:hover i{color:var(--success)}'
  + '.blog-rmi.blog-off{cursor:not-allowed;opacity:.5}'
  + '.blog-rmi.blog-off:hover{background:transparent}'
  + '.blog-rmi.blog-off:hover i{color:var(--text-dim)}'
  + '.blog-rmsep{height:1px;background:var(--border);margin:5px 8px}'
  /* 編輯器 */
  + '.blog-ed-top{background:#fff;border:1px solid var(--border);border-radius:12px;padding:13px 18px;display:flex;align-items:center;gap:12px;margin-bottom:18px;flex-wrap:wrap;position:sticky;top:-26px;z-index:15}'
  + '.blog-back{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text-mid);cursor:pointer}'
  + '.blog-back:hover{color:var(--accent)}'
  + '.blog-sep{width:1px;height:20px;background:var(--border)}'
  + '.blog-auto{font-size:11.5px;color:var(--text-dim);display:flex;align-items:center;gap:6px}'
  + '.blog-auto i{width:6px;height:6px;border-radius:50%;background:#16a34a;display:block}'
  + '.blog-undos{display:flex;gap:2px}'
  + '.blog-ur{width:30px;height:30px;border-radius:7px;border:1px solid var(--border);background:#fff;color:var(--text-mid);cursor:pointer;display:grid;place-items:center;transition:.15s;padding:0}'
  + '.blog-ur:hover:not([disabled]){background:#eff4ff;color:var(--accent);border-color:#c7d2fe}'
  + '.blog-ur[disabled]{opacity:.32;cursor:default}'
  + '.blog-acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}'
  + '.blog-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:22px 24px;margin-bottom:18px}'
  + '.blog-ch{font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:16px;display:flex;align-items:center;gap:8px}'
  + '.blog-ch .blog-n{width:19px;height:19px;border-radius:5px;background:#eff4ff;color:var(--accent);display:grid;place-items:center;font-size:10.5px;font-weight:700}'
  + '.blog-ch .blog-sub{margin-left:auto;font-weight:400;font-size:11.5px;color:var(--text-dim)}'
  + '.blog-row{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:start;margin-bottom:14px}'
  + '.blog-row>label{font-size:12.5px;color:var(--text-mid);padding-top:9px}'
  + '.blog-row>label b{color:var(--danger);font-weight:400;margin-left:2px}'
  + '.blog-i{width:100%;border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13.5px;font-family:inherit;color:var(--text);background:#fff;outline:0}'
  + '.blog-i:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(37,99,235,.1)}'
  + '.blog-i::placeholder{color:rgba(17,24,39,.28)}'
  + '.blog-i.blog-big{font-size:16px;font-weight:600}'
  + 'textarea.blog-i{resize:vertical;line-height:1.85;min-height:70px}'
  + '.blog-hint{font-size:11.5px;color:var(--text-dim);margin-top:5px;line-height:1.7}'
  + '.blog-hint.blog-ok2{color:#16a34a}.blog-hint.blog-warn{color:#b45309}'
  + '.blog-f3{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}'
  + '.blog-chk{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-mid);white-space:nowrap;cursor:pointer}'
  + '.blog-chk i{width:15px;height:15px;border:1.5px solid rgba(0,0,0,.22);border-radius:4px;display:block;position:relative}'
  + '.blog-chk.blog-on i{background:var(--accent);border-color:var(--accent)}'
  + '.blog-chk.blog-on i::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}'
  + '.blog-srcf{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-top:12px}'
  + '.blog-srcf .blog-sl{font-size:11.5px;font-weight:700;color:#b45309;display:flex;align-items:center;gap:6px;margin-bottom:7px}'
  + '.blog-srcf .blog-i{border-color:#fcd34d}'
  + '.blog-cover{display:flex;gap:15px;align-items:center}'
  + '.blog-cover-pv{width:132px;height:88px;border-radius:8px;flex:none;border:1px solid var(--border);background:#e9ecf1 center/cover no-repeat;cursor:zoom-in;position:relative}'
  + '.blog-cover-side{flex:1;min-width:0;display:flex;flex-direction:column;gap:9px}'
  /* 標籤 */
  + '.blog-tagbox{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border:1px solid var(--border);border-radius:8px;padding:6px 9px;background:#fff;min-height:38px}'
  + '.blog-tg{display:inline-flex;align-items:center;gap:6px;background:#eff4ff;color:var(--accent);border:1px solid #dbeafe;border-radius:100px;padding:3px 6px 3px 11px;font-size:12px;font-weight:500}'
  + '.blog-tg i{width:15px;height:15px;border-radius:50%;background:rgba(37,99,235,.14);display:grid;place-items:center;font-style:normal;font-size:10px;cursor:pointer;line-height:1}'
  + '.blog-tg i:hover{background:rgba(37,99,235,.3)}'
  + '.blog-tagbox input{border:0;outline:0;font-family:inherit;font-size:13px;padding:4px 2px;flex:1;min-width:130px;color:var(--text);background:transparent}'
  + '.blog-sugs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}'
  + '.blog-sg{border:1px solid var(--border);border-radius:100px;padding:3px 10px;font-size:11.5px;color:var(--text-dim);cursor:pointer;background:#fff}'
  + '.blog-sg:hover{border-color:var(--accent);color:var(--accent)}'
  + '.blog-sg.blog-off{opacity:.4;cursor:not-allowed}'
  + '.blog-meta{display:flex;gap:26px;flex-wrap:wrap;background:#f8f9fb;border:1px solid var(--border);border-radius:9px;padding:12px 15px}'
  + '.blog-meta .blog-k{font-size:10.5px;letter-spacing:.06em;color:var(--text-dim);margin-bottom:3px}'
  + '.blog-meta .blog-v{font-size:12.5px;color:var(--text-mid);font-weight:500}'
  + '.blog-eye{display:flex;align-items:center;gap:7px;font-size:11.5px;color:#6b7280;margin-top:9px;background:#f3f4f6;border-radius:7px;padding:8px 11px;line-height:1.7}'
  /* 圖片區塊 */
  + '.blog-rp{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#f8f9fb;border:1px solid var(--border);border-radius:8px;padding:9px 12px;margin-bottom:12px}'
  + '.blog-rp .blog-k2{font-size:11.5px;color:var(--text-mid);font-weight:600;margin-right:2px}'
  + '.blog-rb{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);background:#fff;border-radius:7px;padding:6px 11px;font-size:12px;color:var(--text-mid);cursor:pointer;transition:.16s}'
  + '.blog-rb:hover{border-color:var(--accent);color:var(--accent)}'
  + '.blog-rb.blog-on{border-color:var(--accent);background:#eff4ff;color:var(--accent);font-weight:600}'
  + '.blog-rb b{display:block;border:1.6px solid currentColor;border-radius:2px;opacity:.75}'
  + '.blog-rb.blog-r169 b{width:16px;height:9px}.blog-rb.blog-r45 b{width:9px;height:11px}.blog-rb.blog-r11 b{width:11px;height:11px}'
  + '.blog-note{display:flex;gap:10px;align-items:flex-start;background:#f0f9ff;border:1px solid #bae6fd;border-radius:9px;padding:11px 14px;font-size:12px;color:#0369a1;line-height:1.85;margin-bottom:14px}'
  + '.blog-slide{display:grid;grid-template-columns:26px 128px minmax(0,1fr) auto;gap:12px;border:1px solid var(--border);border-radius:9px;padding:11px;margin-bottom:9px;background:#fafbfc;align-items:center}'
  + '.blog-no{width:23px;height:23px;border-radius:6px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:11px;font-weight:700}'
  + '.blog-sth{width:128px;height:84px;border-radius:7px;overflow:hidden;position:relative;border:1px solid var(--border);background:#e9ecf1 center/cover no-repeat;cursor:zoom-in}'
  + '.blog-sth .blog-vp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:25px;border-radius:6px;background:rgba(230,33,23,.94);display:grid;place-items:center;z-index:2}'
  + '.blog-sth .blog-vt{position:absolute;left:6px;bottom:5px;z-index:2;background:rgba(0,0,0,.68);border-radius:3px;padding:1px 5px;font-size:9px;color:#fff}'
  + '.blog-sf{display:grid;grid-template-columns:38px 1fr;gap:8px;align-items:center;margin-bottom:7px}'
  + '.blog-sf label{font-size:11.5px;color:var(--text-dim)}'
  + '.blog-sf .blog-i{padding:6px 10px;font-size:12.5px}'
  + '.blog-sf.blog-src label{color:#b45309;font-weight:600}'
  + '.blog-sf.blog-src .blog-i{border-color:#fcd34d;background:#fffbeb}'
  + '.blog-sops{display:flex;flex-direction:column;gap:4px}'
  + '.blog-sops button{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--text-dim);cursor:pointer;border:1px solid var(--border);background:#fff;font-size:11px}'
  + '.blog-sops button:hover{color:var(--accent);border-color:var(--accent)}'
  + '.blog-sops button.blog-dg:hover{color:var(--danger);border-color:#fecaca}'
  + '.blog-up{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:14px 0 12px}'
  + '.blog-dz{border:1.5px dashed rgba(0,0,0,.14);border-radius:10px;background:#fafbfc;padding:18px;display:flex;align-items:center;justify-content:center;gap:11px;color:var(--text-dim);font-size:12.5px;cursor:pointer;transition:.18s}'
  + '.blog-dz.blog-hot{border-color:var(--accent);background:#f5f9ff;color:var(--accent)}'
  /* Notion 式內文 */
  + '.blog-dh{background:#f8f9fb;border:1px solid var(--border);border-radius:9px;padding:11px 14px;font-size:12px;color:var(--text-mid);line-height:1.9;margin-bottom:16px}'
  + '.blog-dh kbd{background:#fff;border:1px solid rgba(0,0,0,.16);border-bottom-width:2px;border-radius:5px;padding:1px 7px;font-family:Inter,monospace;font-size:11.5px}'
  + '.blog-docbox{border:1px solid var(--border);border-radius:11px;background:#fff;padding:12px 16px 0;transition:.16s}'
  + '.blog-docbox:focus-within{border-color:rgba(37,99,235,.45);box-shadow:0 0 0 3px rgba(37,99,235,.08)}'
  + '.blog-doc{position:relative;padding:4px 0 12px 34px}'
  + '.blog-nb{position:relative;margin:0 0 2px}'
  + '.blog-nbt{position:absolute;left:-34px;top:3px;display:flex;gap:1px;opacity:0;transition:opacity .14s}'
  + '.blog-nb:hover .blog-nbt{opacity:1}'
  + '.blog-nbt span{width:24px;height:26px;border-radius:6px;display:grid;place-items:center;color:rgba(17,24,39,.32);cursor:pointer;font-size:14px;line-height:1;user-select:none}'
  + '.blog-nbt span:hover{background:#eef0f3;color:var(--text)}'
  + '.blog-c{outline:0;font-size:14.5px;line-height:2.05;color:var(--text);padding:4px 6px;border-radius:6px;transition:background .14s}'
  + '.blog-c:focus{background:#f8faff}'
  + '.blog-c[data-ph]:empty::before{content:attr(data-ph);color:rgba(17,24,39,.26)}'
  + '.blog-c.blog-h2{font-family:Syne,sans-serif;font-size:20px;font-weight:700;line-height:1.55;margin-top:16px}'
  + '.blog-c.blog-h3{font-family:Syne,sans-serif;font-size:16.5px;font-weight:700;line-height:1.6;margin-top:12px}'
  /* min-height：空項目也要佔一行。高度 0 的話它的項目符號會疊到下一行上 */
  + '.blog-c.blog-ul>div,.blog-c.blog-ol>div{position:relative;padding-left:22px;margin-bottom:4px;min-height:1.9em}'
  + '.blog-c.blog-ul>div::before{content:"";position:absolute;left:6px;top:.92em;width:5px;height:5px;border-radius:50%;background:var(--accent)}'
  + '.blog-c.blog-ol{counter-reset:blogoli}.blog-c.blog-ol>div{counter-increment:blogoli}'
  + '.blog-c.blog-ol>div::before{content:counter(blogoli) ".";position:absolute;left:2px;color:var(--accent);font-weight:700;font-size:13px}'
  + '.blog-c.blog-quote{border-left:3px solid var(--accent);background:#f6f9ff;padding:11px 15px;color:var(--text-mid)}'
  + '.blog-hr{height:1px;background:var(--border);margin:16px 0}'
  + '.blog-embw{position:relative}'
  + '.blog-emb{width:100%;border-radius:9px;position:relative;overflow:hidden;background:#e9ecf1 center/cover no-repeat;border:1px solid var(--border);cursor:zoom-in;min-height:120px}'
  + '.blog-emb.blog-vid{aspect-ratio:16/9}'
  + '.blog-emb .blog-vp{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:46px;height:32px;border-radius:7px;background:rgba(230,33,23,.94);display:grid;place-items:center;z-index:2}'
  + '.blog-ratio{position:absolute;top:9px;right:9px;z-index:4;background:rgba(6,8,14,.7);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:7px;padding:3px 9px;font-size:10.5px}'
  + '.blog-embt{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:9px}'
  + '.blog-embm{display:flex;flex-direction:column;gap:6px;margin-top:9px}'
  + '.blog-cap,.blog-csrc{border:1px solid transparent;border-radius:6px;padding:5px 8px;font-family:inherit;font-size:12.5px;outline:0;background:transparent;color:var(--text-mid)}'
  + '.blog-cap:hover,.blog-csrc:hover{border-color:var(--border)}'
  + '.blog-cap:focus,.blog-csrc:focus{border-color:var(--accent);background:#fff}'
  + '.blog-csrc{color:#b45309}.blog-csrc:focus{background:#fffbeb;border-color:#fcd34d}'
  + '.blog-foot{display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--border);margin-top:6px;padding:12px 0 13px}'
  + '.blog-foot .blog-fk{font-size:11.5px;color:var(--text-dim);margin-right:2px}'
  + '.blog-foot .blog-fh{font-size:11.5px;color:var(--text-dim);margin-left:auto}'
  /* 浮動選單 */
  + '.blog-slash,.blog-bmenu{position:fixed;z-index:9997;background:#fff;border:1px solid var(--border);border-radius:11px;box-shadow:0 14px 40px rgba(0,0,0,.18);padding:6px;display:none;max-height:min(70vh,520px);overflow-y:auto}'
  + '.blog-slash{width:262px}.blog-bmenu{width:176px}'
  + '.blog-slash.blog-on,.blog-bmenu.blog-on{display:block}'
  + '.blog-sh{font-size:10.5px;letter-spacing:.08em;color:var(--text-dim);padding:6px 9px 7px;font-weight:600}'
  + '.blog-si{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:8px;cursor:pointer}'
  + '.blog-si:hover{background:#eff4ff}'
  + '.blog-si .blog-ic{width:28px;height:28px;border-radius:7px;background:#f3f4f6;display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--text-mid);flex:none}'
  + '.blog-si:hover .blog-ic{background:#dbeafe;color:var(--accent)}'
  + '.blog-si b{display:block;font-size:13px;font-weight:600;color:var(--text)}'
  + '.blog-si em{display:block;font-size:11px;font-style:normal;color:var(--text-dim);margin-top:1px}'
  + '.blog-bi{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:var(--text-mid)}'
  + '.blog-bi:hover{background:#eff4ff;color:var(--accent)}'
  + '.blog-bi.blog-dg:hover{background:#fef2f2;color:var(--danger)}'
  + '.blog-bi span{width:18px;text-align:center;font-size:12.5px}'
  + '.blog-bsep{height:1px;background:var(--border);margin:4px 6px}'
  + '.blog-bcg{display:flex;gap:3px;padding:0 6px 2px}'
  + '.blog-bcg button{min-width:34px;padding:0 7px;height:29px;border-radius:7px;border:1px solid var(--border);background:#fff;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:600;color:var(--text-mid)}'
  + '.blog-bcg button:hover{background:#eff4ff;color:var(--accent);border-color:#c7d2fe}'
  /* 選取文字後浮出的格式工具列 */
  + '.blog-fmt{position:fixed;z-index:9999;display:none;align-items:center;gap:2px;background:#1f2430;border-radius:9px;box-shadow:0 10px 34px rgba(0,0,0,.32);padding:4px 5px}'
  + '.blog-fmt.blog-on{display:flex}'
  + '.blog-fg{display:flex;align-items:center;gap:1px}'
  + '.blog-fx{width:1px;height:19px;background:rgba(255,255,255,.16);margin:0 4px}'
  + '.blog-fmt.blog-blkonly .blog-fx,.blog-fmt.blog-blkonly .blog-fg~.blog-fg{display:none}'
  + '.blog-fmt button{min-width:28px;height:28px;padding:0 6px;border:0;background:transparent;color:#e5e7eb;border-radius:6px;cursor:pointer;font-family:inherit;font-size:12.5px;line-height:1;display:inline-flex;align-items:center;justify-content:center;gap:2px;position:relative}'
  + '.blog-fmt button:hover{background:rgba(255,255,255,.14);color:#fff}'
  + '.blog-fmt button.blog-on{background:var(--accent);color:#fff}'
  + '.blog-fmt button code{background:rgba(255,255,255,.14);border-radius:3px;padding:1px 3px;font-size:10.5px}'
  + '.blog-fmt .blog-fa{font-weight:700;font-size:13px}'
  + '.blog-fmt .blog-fam{font-size:11px}'
  + '.blog-fmt button i{position:absolute;left:5px;right:5px;bottom:3px;height:3px;border-radius:2px;display:block}'
  /* 色盤 */
  + '.blog-pal{position:fixed;z-index:10000;display:none;background:#fff;border:1px solid var(--border);border-radius:11px;box-shadow:0 14px 40px rgba(0,0,0,.2);padding:10px;width:214px}'
  + '.blog-pal.blog-on{display:block}'
  + '.blog-ph{font-size:10.5px;letter-spacing:.08em;color:var(--text-dim);font-weight:600;margin-bottom:8px}'
  + '.blog-pg{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:10px}'
  + '.blog-sw{width:100%;padding-top:100%;border-radius:6px;cursor:pointer;border:1px solid rgba(0,0,0,.12);display:block}'
  + '.blog-sw:hover{outline:2px solid var(--accent);outline-offset:1px}'
  + '.blog-pf{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-mid);border-top:1px solid var(--border);padding-top:9px;margin-bottom:8px}'
  + '.blog-pf input{width:42px;height:26px;padding:0;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer}'
  + '.blog-pc{width:100%;padding:7px;border:1px solid var(--border);background:#fff;border-radius:7px;font-family:inherit;font-size:12px;color:var(--text-mid);cursor:pointer}'
  + '.blog-pc:hover{background:#f4f5f7;color:var(--text)}'
  /* 內文裡行內格式的長相 */
  + '.blog-doc code{background:#f1f3f6;border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-family:Inter,ui-monospace,monospace;font-size:.9em}'
  + '.blog-doc a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}'
  + '.blog-doc s{opacity:.7}'
  /* 鎖定橫幅 */
  + '.blog-lock{display:flex;align-items:center;gap:11px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:13px 17px;margin-bottom:18px;font-size:13px;color:#065f46;flex-wrap:wrap;line-height:1.8}'
  + '.blog-locked{position:relative}'
  + '.blog-locked::after{content:"";position:absolute;inset:0;background:rgba(244,245,247,.55);border-radius:12px;cursor:not-allowed}'
  /* 燈箱 */
  + '.blog-lb{position:fixed;inset:0;background:rgba(9,12,18,.88);z-index:9998;display:none;align-items:center;justify-content:center;padding:40px}'
  + '.blog-lb.blog-on{display:flex}'
  + '.blog-lb img{max-width:100%;max-height:82vh;border-radius:12px;display:block}'
  + '.blog-lbx{position:absolute;top:18px;right:24px;width:38px;height:38px;border-radius:9px;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;font-size:22px;cursor:pointer}'
  + '.blog-lbc{margin-top:14px;color:rgba(255,255,255,.62);font-size:13px;text-align:center}'
  /* 抽屜 */
  + '.blog-mask{position:fixed;inset:0;background:rgba(17,24,39,.4);z-index:9990}'
  + '.blog-dw{position:fixed;top:0;right:0;bottom:0;width:470px;max-width:100%;background:#fff;z-index:9991;box-shadow:-14px 0 44px rgba(0,0,0,.16);display:flex;flex-direction:column}'
  + '.blog-dwh{padding:19px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px}'
  + '.blog-dwh h3{font-family:Syne,sans-serif;font-size:1.05rem;font-weight:700}'
  + '.blog-dwx{margin-left:auto;width:29px;height:29px;border-radius:7px;display:grid;place-items:center;color:var(--text-dim);cursor:pointer}'
  + '.blog-dwx:hover{background:#f0f1f4}'
  + '.blog-dws{padding:12px 22px;background:#f8f9fb;border-bottom:1px solid var(--border);font-size:12.5px;color:var(--text-mid)}'
  + '.blog-dwb{flex:1;overflow-y:auto;padding:20px 22px}'
  + '.blog-tl{display:grid;grid-template-columns:26px 1fr;gap:13px;padding-bottom:20px;position:relative}'
  + '.blog-tl::before{content:"";position:absolute;left:12px;top:26px;bottom:0;width:1.5px;background:var(--border)}'
  + '.blog-tl:last-child::before{display:none}'
  + '.blog-tld{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;z-index:1;font-size:12px}'
  + '.blog-tld.blog-pub{background:#dcfce7;color:#16a34a}.blog-tld.blog-unp{background:#fef3c7;color:#d97706}'
  + '.blog-tld.blog-edt{background:#dbeafe;color:#2563eb}.blog-tld.blog-crt{background:#f3f4f6;color:rgba(17,24,39,.45)}'
  + '.blog-tlt{font-size:13.5px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
  + '.blog-tlw{font-size:11.5px;color:var(--text-dim);margin-top:3px}'
  + '.blog-tlm{margin-top:8px;background:#f8f9fb;border:1px solid var(--border);border-radius:7px;padding:8px 11px;font-size:12.5px;color:var(--text-mid);line-height:1.75}'
  + '.blog-tla{margin-top:9px;display:flex;gap:7px}'
  + '.blog-tla button{font-size:11.5px;color:var(--accent);border:1px solid #dbeafe;background:#f8faff;border-radius:6px;padding:4px 10px;cursor:pointer}'
  + '.blog-tla button:hover{background:#eff4ff}'
  /* 手機 */
  + '@media(max-width:820px){'
  +   '.blog-row{grid-template-columns:1fr;gap:6px}.blog-row>label{padding-top:0;font-weight:600}'
  +   '.blog-slide{grid-template-columns:26px 1fr;gap:10px}.blog-sth{width:100%;height:150px}'
  +   '.blog-sops{flex-direction:row;grid-column:1/-1}'
  +   '.blog-cover{flex-direction:column;align-items:stretch}.blog-cover-pv{width:100%;height:130px}'
  +   '.blog-ed-top{position:static}.blog-acts{width:100%}.blog-acts button{flex:1;justify-content:center}'
  + '}';
  var st = document.createElement('style');
  st.id = 'blog-admin-style';
  st.textContent = css;
  document.head.appendChild(st);
}

/* ═══ 讀取 ═══════════════════════════════════════════════════════════ */
async function loadBlogPosts(){
  blogInjectStyle();
  var main = document.getElementById('main-content');
  if (main) main.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-dim);font-size:13px;">載入中…</div>';

  var r = await sb.from('blog_posts').select('*').order('updated_time', { ascending:false });
  if (r.error){
    if (main) main.innerHTML = '<div style="padding:60px 24px;text-align:center;color:#dc2626;font-size:13px;line-height:2;">讀取失敗：' + bgEsc(r.error.message)
      + '<div style="font-size:12px;color:#6b7280;max-width:620px;margin:12px auto 0;text-align:left;background:#f9fafb;border-radius:8px;padding:12px 16px;line-height:1.9;">'
      + '若訊息與權限或 RLS 有關，代表 <b>blog_schema.sql</b> 還沒有在 Supabase 執行，或是目前登入的帳號在 admin_users 裡的 auth_uid 沒有對上。</div></div>';
    return;
  }
  BLOG_DB = r.data || [];

  var rc = await sb.from('blog_categories').select('*').eq('active', true).order('sort_order');
  BLOG_CATS = (rc && rc.data) || [];

  var rt = await sb.from('blog_tag_cloud').select('*');
  BLOG_TAGS = ((rt && rt.data) || []).map(function(x){ return x.tag; });

  if (typeof _restoreView === 'function') { try { _restoreView('blog_posts'); } catch(e){} }
  renderBlogList();
}

/* ═══ 列表 ═══════════════════════════════════════════════════════════ */
/* 篩選一律沿用主檔的多選下拉元件 msDropdown()，外觀與其他頁面完全一致 */
function blogMsSel(id){
  return (typeof msSel === 'function') ? msSel(id) : [];
}
function blogFiltered(){
  var q    = (blogSearch || '').trim().toLowerCase();
  var cats = blogMsSel('blog-cat');
  var ops  = blogMsSel('blog-op');
  return BLOG_DB.filter(function(p){
    if (blogTab !== 'all' && p.status !== blogTab) return false;
    if (cats.length){
      var c = p.category || '__none';
      if (cats.indexOf(c) < 0) return false;
    }
    if (ops.length && ops.indexOf(p.updated_by || p.created_by || '') < 0) return false;
    if (!q) return true;
    var hay = [p.title, p.summary, p.slug].concat(p.tags || []).join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}
/* 只受「分類 / 操作者 / 搜尋」影響，不受狀態頁籤影響 —— 用來算各頁籤的筆數 */
function blogScoped(){
  var save = blogTab; blogTab = 'all';
  var r = blogFiltered();
  blogTab = save;
  return r;
}

function renderBlogList(){
  blogInjectStyle();
  blogHideFmt();          // 從編輯器回到列表時，浮動工具列不要留在畫面上
  var main = document.getElementById('main-content');
  if (!main) return;
  var isAdmin = bgIsAdmin();

  var catOpts = BLOG_CATS.map(function(c){ return { v:c.slug, l:c.name }; });
  catOpts.push({ v:'__none', l:'未分類' });

  var opSet = {};
  BLOG_DB.forEach(function(p){ var n = p.updated_by || p.created_by; if (n) opSet[n] = 1; });
  var opOpts = Object.keys(opSet).sort().map(function(n){ return { v:n, l:n }; });

  var ms = (typeof msDropdown === 'function')
    ? msDropdown('blog-cat', '全部分類', catOpts, '_blogApply')
      + msDropdown('blog-op', '全部操作者', opOpts, '_blogApply')
    : '';

  var tabs = [['all','全部'],['draft','草稿'],['published','發佈中'],['unpublished','已下架'],['archived','封存']]
    .map(function(t){
      return '<div class="blog-tab' + (blogTab === t[0] ? ' blog-on' : '') + '" data-tab="' + t[0] + '" onclick="blogSetTab(\'' + t[0] + '\')">'
           + t[1] + ' <span class="blog-c" data-count="' + t[0] + '">0</span></div>';
    }).join('');

  main.innerHTML =
    '<div class="page-header">'
    + '<div class="breadcrumb"><span>官網管理</span><span class="sep">›</span><span>部落格文章</span></div>'
    + '<h1>部落格文章</h1>'
    + '<p>資料表：<code style="font-size:12px;color:var(--text-dim);background:#f3f4f6;padding:2px 7px;border-radius:4px;">blog_posts</code>　官網「洞察文章」的文章管理與發佈</p>'
    + '</div>'
    + '<div class="blog-tabs">' + tabs + '</div>'
    + '<div class="toolbar"><div class="toolbar-left">'
    +   '<div class="search-box" style="width:300px;"><svg class="search-icon" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="9" r="6"/><path d="M15 15l3 3" stroke-linecap="round"/></svg>'
    +   '<input id="blog-search-input" type="text" placeholder="搜尋標題、摘要或標籤…"></div>'
    +   ms
    + '</div><div class="toolbar-right" style="display:flex;gap:8px;">'
    +   (typeof _exportBtn === 'function' ? _exportBtn('blogExportCsv') : '')
    +   (isAdmin ? '<button class="btn btn-primary" onclick="openBlogEditor(null)"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10 4v12M4 10h12" stroke-linecap="round"/></svg> 新增文章</button>' : '')
    + '</div></div>'
    + '<div class="table-card"><div class="table-wrap" style="overflow-x:auto;"><table style="min-width:max-content;width:100%;">'
    + '<thead><tr>'
    +   '<th style="width:70px">封面</th><th>標題</th><th style="width:82px">分類</th><th style="width:92px">狀態</th>'
    +   '<th style="width:104px">最後操作</th><th style="width:112px">發佈時間</th><th style="width:112px">最後更新</th>'
    +   '<th style="width:96px;text-align:right">操作</th>'
    + '</tr></thead><tbody id="blog-tbody"></tbody></table></div>'
    + '<div class="pagination" id="blog-pager"></div></div>';

  // 搜尋框改用 addEventListener（沿用主檔客戶資料頁的做法）：
  // 只重繪表格、不重繪整頁，打字時游標才不會跳掉
  var se = document.getElementById('blog-search-input');
  if (se){
    se.value = blogSearch;
    se.addEventListener('input', function(){
      blogSearch = this.value;
      blogPage = 1;
      blogUpdateTable();
    });
  }
  blogUpdateTable();
}

function blogUpdateTable(){
  blogHideRowMenu();          // 表格重繪後原本的按鈕會消失，選單要先收掉
  var scoped = blogScoped();
  var counts = { all: scoped.length, draft:0, published:0, unpublished:0, archived:0 };
  scoped.forEach(function(p){ if (counts[p.status] != null) counts[p.status]++; });
  document.querySelectorAll('.blog-c[data-count]').forEach(function(el){
    el.textContent = counts[el.getAttribute('data-count')] || 0;
  });
  document.querySelectorAll('.blog-tab[data-tab]').forEach(function(el){
    el.classList.toggle('blog-on', el.getAttribute('data-tab') === blogTab);
  });

  var rows  = blogFiltered();
  var pages = Math.max(1, Math.ceil(rows.length / 25));
  if (blogPage > pages) blogPage = pages;
  var slice = rows.slice((blogPage - 1) * 25, blogPage * 25);

  var tb = document.getElementById('blog-tbody');
  if (tb) tb.innerHTML = slice.length
    ? slice.map(blogRowHtml).join('')
    : (typeof renderEmptyState === 'function' ? renderEmptyState(8) : '<tr><td colspan="8" style="padding:40px;text-align:center;color:#9ca3af;">沒有符合條件的文章</td></tr>');

  var pg = document.getElementById('blog-pager');
  if (pg) pg.innerHTML = '<span>共 ' + rows.length + ' 筆資料'
    + (rows.length ? '，顯示 ' + ((blogPage-1)*25+1) + '–' + Math.min(blogPage*25, rows.length) : '') + '</span>'
    + '<div class="page-controls">' + (typeof buildPageBtns === 'function' ? buildPageBtns(blogPage, pages, 'blogGoPage') : '') + '</div>';

  if (typeof _persistView === 'function') { try { _persistView('blog_posts'); } catch(e){} }
}

var BLOG_ICON = {
  edit: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13 3l4 4L7 17H3v-4z"/></svg>',
  eye:  '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M1 10s3.5-5.5 9-5.5S19 10 19 10s-3.5 5.5-9 5.5S1 10 1 10z"/><circle cx="10" cy="10" r="2.4"/></svg>',
  down: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 17V8m0 0L7 11m3-3l3 3"/><path d="M4 6V4a1 1 0 011-1h10a1 1 0 011 1v2"/></svg>',
  up:   '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 3v9m0-9l3 3m-3-3L7 6"/><path d="M4 13v3a1 1 0 001 1h10a1 1 0 001-1v-3"/></svg>',
  hist: '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/></svg>',
  box:  '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="4" width="16" height="4" rx="1"/><path d="M4 8v8a1 1 0 001 1h10a1 1 0 001-1V8M8 12h4"/></svg>',
  del:  '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/></svg>',
  caret:'<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 8l5 5 5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

/* 這一列目前可以做哪些事 —— 依狀態與權限決定 */
function blogRowActions(p){
  var isAdmin = bgIsAdmin();
  var pub = p.status === 'published';
  var L = [];

  if (pub)            L.push({ off:1, ic:'edit', t:'編輯內容', d:'發佈中不可編輯，請先下架' });
  else if (!isAdmin)  L.push({ off:1, ic:'edit', t:'編輯內容', d:'你的權限是檢視者，不可修改' });
  else                L.push({ ic:'edit', t:'編輯內容', d:'開啟編輯器修改這一篇', fn:'openBlogEditor(' + p.id + ')' });

  L.push({ ic:'eye', t:'預覽', d:'看看官網上呈現的樣子', fn:'blogPreview(' + p.id + ')' });

  if (isAdmin){
    L.push({ sep:1 });
    if (p.status === 'draft')
      L.push({ cls:'blog-ok', ic:'up', t:'發佈', d:'文章會出現在官網上', fn:'blogPublish(' + p.id + ')' });
    if (p.status === 'unpublished')
      L.push({ cls:'blog-ok', ic:'up', t:'重新發佈', d:'修改完成，讓它重新上架', fn:'blogPublish(' + p.id + ')' });
    if (pub)
      L.push({ ic:'down', t:'下架', d:'官網改顯示維護中的提示', fn:'blogUnpublish(' + p.id + ')' });
    if (p.status === 'unpublished' || p.status === 'draft')
      L.push({ ic:'box', t:'封存', d:'收進封存頁籤，不再列入日常', fn:'blogArchive(' + p.id + ')' });
    if (p.status === 'archived')
      L.push({ cls:'blog-ok', ic:'up', t:'取回為草稿', d:'從封存還原成可編輯的狀態', fn:'blogRestoreDraft(' + p.id + ')' });
  }

  L.push({ sep:1 });
  L.push({ ic:'hist', t:'異動紀錄', d:'誰在什麼時候改了什麼', fn:'blogHistory(' + p.id + ')' });
  if (isAdmin){
    L.push({ sep:1 });
    L.push({ cls:'blog-dg', ic:'del', t:'刪除文章', d:'連同圖片與紀錄一起清除', fn:'blogDelete(' + p.id + ')' });
  }
  return L;
}

function blogRowMenuHtml(p){
  /* 去掉連續或結尾的分隔線，避免某些狀態下出現兩條線黏在一起 */
  var src = blogRowActions(p), L = [];
  src.forEach(function(it){
    if (it.sep && (!L.length || L[L.length-1].sep)) return;
    L.push(it);
  });
  while (L.length && L[L.length-1].sep) L.pop();

  return '<div class="blog-rmh">要對這一篇做什麼？<b>' + bgEsc(p.title || '（未命名）') + '</b></div>'
    + L.map(function(it){
        if (it.sep) return '<div class="blog-rmsep"></div>';
        var inner = '<i>' + (BLOG_ICON[it.ic] || '') + '</i>'
                  + '<span class="blog-rmt"><b>' + it.t + '</b><em>' + it.d + '</em></span>';
        return it.off
          ? '<div class="blog-rmi blog-off">' + inner + '</div>'
          : '<button class="blog-rmi ' + (it.cls || '') + '" onclick="blogHideRowMenu();' + it.fn + '">' + inner + '</button>';
      }).join('');
}

var _blogRowMenuId = null, _blogRowMenuBound = false;

function blogEnsureRowMenu(){
  var m = document.getElementById('blog-rmenu');
  if (!m){
    m = document.createElement('div');
    m.id = 'blog-rmenu'; m.className = 'blog-rmenu';
    document.body.appendChild(m);          // 掛在 body 上，不受 .main 有沒有 position 影響
  }
  if (!_blogRowMenuBound){
    _blogRowMenuBound = true;
    document.addEventListener('click', function(e){
      if (!e.target.closest('#blog-rmenu') && !e.target.closest('.blog-rowbtn')) blogHideRowMenu();
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') blogHideRowMenu(); });
    var sc = document.querySelector('.main');
    if (sc) sc.addEventListener('scroll', blogHideRowMenu, { passive:true });
    window.addEventListener('resize', blogHideRowMenu);
  }
  return m;
}

function blogRowMenu(id, btn){
  var m = blogEnsureRowMenu();
  if (_blogRowMenuId === id && m.classList.contains('blog-on')){ blogHideRowMenu(); return; }
  var p = blogFind(id);
  if (!p) return;
  blogHideRowMenu();
  _blogRowMenuId = id;
  m.innerHTML = blogRowMenuHtml(p);
  if (btn) btn.classList.add('blog-on');
  blogFloatAt(m, btn, 'right');
}

function blogHideRowMenu(){
  var m = document.getElementById('blog-rmenu');
  if (m) m.classList.remove('blog-on');
  _blogRowMenuId = null;
  document.querySelectorAll('.blog-rowbtn.blog-on').forEach(function(b){ b.classList.remove('blog-on'); });
}

function blogRowHtml(p){
  var st = BLOG_STATUS[p.status] || BLOG_STATUS.draft;
  var cat = BLOG_CATS.filter(function(c){ return c.slug === p.category; })[0];
  var thumb = p.cover_url ? ' style="background-image:url(\'' + bgEsc(p.cover_url) + '\')"' : '';
  var tags = (p.tags || []).map(function(t){ return '<span>#' + bgEsc(t) + '</span>'; }).join('');

  var ops = '<button class="blog-rowbtn" onclick="blogRowMenu(' + p.id + ', this)">管理' + BLOG_ICON.caret + '</button>';

  return '<tr' + (p.status === 'unpublished' ? ' style="background:#fffbf5"' : '') + '>'
    + '<td><span class="blog-th"' + thumb + '></span></td>'
    + '<td><span class="blog-name">' + bgEsc(p.title || '（未命名）') + (p.is_pinned ? '<span class="blog-pin">置頂</span>' : '') + '</span>'
    +     '<span class="blog-slug">/blog/' + bgEsc(p.slug) + '/</span>'
    +     (tags ? '<span class="blog-rowtags">' + tags + '</span>' : '') + '</td>'
    + '<td>' + (cat ? '<span class="blog-bd" style="background:#ede9fe;color:#7c3aed">' + bgEsc(cat.name) + '</span>' : '<span class="blog-bd blog-bd-gray">未分類</span>') + '</td>'
    + '<td><span class="blog-bd ' + st.cls + '"><i></i>' + st.label + '</span></td>'
    + '<td>' + bgEsc(p.updated_by || p.created_by || '—') + '</td>'
    + '<td>' + bgDate(p.published_at) + '</td>'
    + '<td>' + bgDate(p.updated_time) + '</td>'
    + '<td><div class="blog-ops">' + ops + '</div></td>'
    + '</tr>';
}

function blogSetTab(t){ blogTab = t; blogPage = 1; blogUpdateTable(); }
function _blogApply(){ blogPage = 1; blogUpdateTable(); }
function blogGoPage(p){ blogPage = p; blogUpdateTable(); }
function blogFind(id){ return BLOG_DB.filter(function(p){ return p.id === id; })[0]; }

/* 匯出 CSV（沿用主檔的 _downloadCsv，含 BOM，Excel 開不會亂碼） */
function blogExportCsv(){
  var rows = blogFiltered().map(function(p){
    return [ p.id, p.slug, p.title, p.summary,
             (BLOG_CATS.filter(function(c){ return c.slug === p.category; })[0] || {}).name || '未分類',
             (p.tags || []).join(' / '),
             (BLOG_STATUS[p.status] || {}).label || p.status,
             p.is_pinned ? '是' : '',
             p.created_by || '', p.updated_by || '', p.published_by || '',
             bgDt(p.published_at), bgDt(p.updated_time) ];
  });
  if (!rows.length){ bgToast('目前沒有符合條件的資料可以匯出', 'err'); return; }
  var header = ['ID','網址代稱','標題','摘要','分類','標籤','狀態','置頂','建立者','最後編輯','發佈者','發佈時間','最後更新'];
  if (typeof _downloadCsv === 'function') _downloadCsv('部落格文章', header, rows);
  else bgToast('匯出功能需要主檔的 _downloadCsv()', 'err');
}

/* ═══ 狀態流轉 ═══════════════════════════════════════════════════════ */
async function blogSetStatus(id, next, action, note){
  var p = blogFind(id);
  if (!p) return;
  var now = new Date().toISOString();
  var patch = { status: next, updated_by: bgMe() };

  if (next === 'published'){
    patch.last_published_at = now;
    patch.published_by = bgMe();
    if (!p.published_at) patch.published_at = now;
  } else if (next === 'unpublished'){
    patch.unpublished_at = now;
  }

  var r = await sb.from('blog_posts').update(patch).eq('id', id);
  if (r.error){ bgToast('操作失敗：' + r.error.message, 'err'); return false; }

  try { await sb.rpc('blog_log_revision', { p_post_id:id, p_action:action, p_note:note || null, p_operator:bgMe() }); } catch(e){}
  await loadBlogPosts();
  return true;
}

async function blogPublish(id){
  var p = blogFind(id); if (!p) return;
  var miss = blogValidate(p);
  if (miss.length){ bgToast('還不能發佈：' + miss.join('、'), 'err'); return; }
  if (!confirm('確定要發佈這篇文章嗎？\n\n發佈後官網會立刻看得到，而且文章會變成唯讀 —— 要再修改必須先下架。')) return;
  var first = !p.published_at;
  if (await blogSetStatus(id, 'published', first ? 'publish' : 'republish')){
    bgToast(first ? '已發佈' : '已重新發佈');
    blogTriggerBuild();
  }
}
async function blogUnpublish(id){
  var note = prompt('下架原因／備註（可留空，會寫進異動紀錄）：', '');
  if (note === null) return;
  if (await blogSetStatus(id, 'unpublished', 'unpublish', note)){
    bgToast('已下架。官網上這篇會顯示「維護中」提示，不是 404。');
    blogTriggerBuild();
  }
}
async function blogArchive(id){
  if (!confirm('封存後這篇文章會從主列表收起來，資料保留、隨時可以取回。要繼續嗎？')) return;
  if (await blogSetStatus(id, 'archived', 'archive')) bgToast('已封存');
}
async function blogRestoreDraft(id){
  if (await blogSetStatus(id, 'draft', 'restore')) bgToast('已取回為草稿');
}

/* 發佈檢核 */
function blogValidate(p){
  var miss = [];
  if (!String(p.title || '').trim())    miss.push('標題');
  if (!String(p.summary || '').trim())  miss.push('摘要');
  if (!p.category)                      miss.push('分類');
  if (!p.cover_url)                     miss.push('封面圖');
  var blocks = (p.content && p.content.blocks) || [];
  var hasText = blocks.some(function(b){
    return (b.type === 'paragraph' && String(b.html || '').replace(/<[^>]*>/g,'').trim())
        || (b.type === 'heading'   && String(b.text || '').trim())
        || (b.type === 'list'      && (b.items || []).length)
        || (b.type === 'quote'     && String(b.text || '').trim());
  });
  if (!hasText) miss.push('內文至少一段');
  return miss;
}

/* 觸發 Netlify 重建（Build Hook 尚未設定時安靜跳過） */
function blogTriggerBuild(){
  var hook = window.GC_NETLIFY_BUILD_HOOK;
  if (!hook) return;
  try { fetch(hook, { method:'POST', mode:'no-cors' }); } catch(e){}
}

/* ═══ 刪除（倒數 5 秒二次確認，比照貨盤模組） ═══════════════════════ */
var _blogDelTimer = null;
function blogDelete(id){
  var p = blogFind(id); if (!p) return;
  blogDelClose();
  var m = document.createElement('div');
  m.id = 'blog-del-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.45);z-index:9995;display:flex;align-items:center;justify-content:center;padding:24px;';
  m.innerHTML =
    '<div style="background:#fff;border-radius:14px;max-width:460px;width:100%;padding:26px 28px;box-shadow:0 24px 60px rgba(0,0,0,.24)">'
    + '<div style="font-family:Syne,sans-serif;font-size:1.05rem;font-weight:700;margin-bottom:12px;color:#dc2626">刪除文章</div>'
    + '<div style="font-size:13.5px;line-height:2;color:var(--text-mid)">即將刪除：<b style="color:var(--text)">' + bgEsc(p.title || '（未命名）') + '</b><br>'
    + '這會一併刪除該篇的<b>所有異動紀錄</b>與<b>已上傳的圖片</b>，無法復原。</div>'
    + '<div style="display:flex;gap:9px;justify-content:flex-end;margin-top:22px">'
    +   '<button class="btn btn-secondary" id="blog-del-cancel" onclick="blogDelClose()">取消</button>'
    +   '<button class="btn btn-primary" id="blog-del-go" disabled style="background:#dc2626">確認刪除（5）</button>'
    + '</div></div>';
  document.body.appendChild(m);

  var n = 5;
  var btn = document.getElementById('blog-del-go');
  _blogDelTimer = setInterval(function(){
    n--;
    if (n > 0){ btn.textContent = '確認刪除（' + n + '）'; return; }
    clearInterval(_blogDelTimer); _blogDelTimer = null;
    btn.textContent = '確認刪除';
    btn.disabled = false;
    btn.onclick = function(){ blogDelRun(id); };
  }, 1000);
}
function blogDelClose(){
  if (_blogDelTimer){ clearInterval(_blogDelTimer); _blogDelTimer = null; }
  var m = document.getElementById('blog-del-modal');
  if (m) m.remove();
}
async function blogDelRun(id){
  var btn = document.getElementById('blog-del-go');
  if (btn){ btn.disabled = true; btn.textContent = '刪除中…'; }
  var c = document.getElementById('blog-del-cancel'); if (c) c.disabled = true;

  // 先清 Storage 底下的圖，再刪資料列（紀錄由 ON DELETE CASCADE 帶走）
  try {
    var ls = await sb.storage.from(BLOG_BUCKET).list('posts/' + id);
    var files = ((ls && ls.data) || []).map(function(f){ return 'posts/' + id + '/' + f.name; });
    if (files.length) await sb.storage.from(BLOG_BUCKET).remove(files);
  } catch(e){}

  var r = await sb.from('blog_posts').delete().eq('id', id);
  blogDelClose();
  if (r.error){ bgToast('刪除失敗：' + r.error.message, 'err'); return; }
  bgToast('已刪除');
  await loadBlogPosts();
  blogTriggerBuild();
}

/* ═══ 預覽 ═══════════════════════════════════════════════════════════ */
/* 預覽要開在哪個官網
   正式環境當然是 worldoflandmark.com。但在本機測試時，正式站上可能還沒有
   blog-post.html，開過去只會看到 404。所以偵測到後台自己跑在本機時，
   會問一次你本機官網的網址（netlify dev 通常是 http://localhost:8888），
   記起來之後就不再問。要改的話在主控台執行：
     localStorage.removeItem('gc_blog_preview_base')
   然後再按一次預覽即可。 */
function blogPreviewBase(){
  var h = location.hostname;
  var isLocal = location.protocol === 'file:' || !h || h === 'localhost' || h === '127.0.0.1' || /^192\.168\./.test(h);
  if (!isLocal) return BLOG_SITE;
  var saved = '';
  try { saved = localStorage.getItem('gc_blog_preview_base') || ''; } catch(e){}
  if (saved) return saved.replace(/\/+$/, '');
  var v = prompt(
    '你正在本機執行後台。\n\n請輸入本機官網的網址，預覽才開得起來。\n' +
    '用 netlify dev 跑官網的話，通常就是下面這一個。\n\n' +
    '（之後不會再問。要改的話在主控台執行 localStorage.removeItem(\'gc_blog_preview_base\') 再按一次預覽。）',
    'http://localhost:8888');
  if (v === null) return BLOG_SITE;
  v = String(v).trim().replace(/\/+$/, '');
  if (!v) return BLOG_SITE;
  try { localStorage.setItem('gc_blog_preview_base', v); } catch(e){}
  return v;
}

/* 預覽
   後台與官網是兩個不同網域，登入狀態不共用，所以官網那邊沒辦法用你的身分
   去讀一篇還沒發佈的草稿。做法改成：把文章內容編碼放進網址的 # 之後
   （# 不會送到伺服器、也不會留在伺服器紀錄裡），官網讀到就直接渲染。
   這樣草稿、已下架、甚至還沒存檔的即時內容都能預覽。 */
function blogPreview(id){
  var p = blogFind(id);
  // 編輯器正開著這一篇，就用畫面上的最新狀態 —— 還沒按儲存也能先看效果
  if (BLOG_EDIT && (id == null || BLOG_EDIT.id === id)){
    p = JSON.parse(JSON.stringify(BLOG_EDIT));
    try { p.content = { v:1, blocks: blogReadDoc() }; } catch(e){}
  }
  if (!p) return;

  var cat = BLOG_CATS.filter(function(c){ return c.slug === p.category; })[0];
  var payload = {
    slug: p.slug || '', title: p.title || '', summary: p.summary || '',
    cover_url: p.cover_url || null, cover_source: p.cover_source || null,
    category: p.category || null, category_name: (cat && cat.name) || '',
    tags: p.tags || [], gallery: p.gallery || [], gallery_ratio: p.gallery_ratio || '16:9',
    content: p.content || { v:1, blocks:[] },
    published_at: p.published_at || null, last_published_at: p.last_published_at || null,
    meta_title: p.meta_title || null, meta_description: p.meta_description || null
  };

  var enc;
  try { enc = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(payload))))); }
  catch(e){ bgToast('預覽資料轉換失敗，請先儲存草稿再試一次。', 'err'); return; }

  var base = blogPreviewBase();
  var url = base + '/blog-post.html#gcpreview=' + enc;
  if (url.length > 200000){          // 極長的文章：退回用正式網址（僅限已發佈）
    if (p.status === 'published' && p.slug) url = base + '/blog/' + encodeURIComponent(p.slug) + '/';
    else { bgToast('這篇文章太長，預覽網址塞不下。請先儲存草稿並發佈後再從官網檢視。', 'err'); return; }
  }
  window.open(url, '_blank');
}

/* ═══ 異動紀錄抽屜 ═══════════════════════════════════════════════════ */
var BLOG_REVS = [];
async function blogHistory(id){
  var p = blogFind(id); if (!p) return;
  blogCloseDrawer();
  var mask = document.createElement('div');
  mask.className = 'blog-mask'; mask.id = 'blog-mask';
  mask.onclick = blogCloseDrawer;
  var dw = document.createElement('div');
  dw.className = 'blog-dw'; dw.id = 'blog-dw';
  dw.innerHTML =
    '<div class="blog-dwh"><h3>異動紀錄</h3><div class="blog-dwx" onclick="blogCloseDrawer()">'
    + '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5l10 10M15 5L5 15"/></svg></div></div>'
    + '<div class="blog-dws">' + bgEsc(p.title || '（未命名）') + '</div>'
    + '<div class="blog-dwb" id="blog-dwb"><div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px">載入中…</div></div>';
  document.body.appendChild(mask);
  document.body.appendChild(dw);

  var r = await sb.from('blog_post_revisions').select('*').eq('post_id', id).order('revision_no', { ascending:false });
  var box = document.getElementById('blog-dwb');
  if (!box) return;
  if (r.error){ box.innerHTML = '<div style="padding:30px;color:#dc2626;font-size:13px">讀取失敗：' + bgEsc(r.error.message) + '</div>'; return; }
  BLOG_REVS = r.data || [];
  var sub = document.querySelector('#blog-dw .blog-dws');
  if (sub) sub.textContent = (p.title || '（未命名）') + '　·　共 ' + BLOG_REVS.length + ' 次異動';

  if (!BLOG_REVS.length){ box.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);font-size:13px">還沒有異動紀錄</div>'; return; }

  var LABEL = { create:'建立草稿', edit:'修改內容', publish:'首次發佈', unpublish:'下架', republish:'重新發佈', archive:'封存', restore:'取回為草稿', delete:'刪除' };
  var DOT   = { create:'blog-crt', edit:'blog-edt', publish:'blog-pub', republish:'blog-pub', unpublish:'blog-unp', archive:'blog-crt', restore:'blog-edt' };
  var ICO   = { create:'＋', edit:'✎', publish:'↑', republish:'↑', unpublish:'↓', archive:'▤', restore:'↺' };
  var isAdmin = bgIsAdmin();

  box.innerHTML = BLOG_REVS.map(function(rev, i){
    var canRestore = isAdmin && p.status !== 'published';
    return '<div class="blog-tl">'
      + '<div class="blog-tld ' + (DOT[rev.action] || 'blog-crt') + '">' + (ICO[rev.action] || '·') + '</div>'
      + '<div><div class="blog-tlt">' + (LABEL[rev.action] || rev.action)
      +   (i === 0 && p.status === 'published' ? ' <span class="blog-bd blog-bd-green" style="font-size:10px"><i></i>目前線上版</span>' : '') + '</div>'
      + '<div class="blog-tlw">' + bgEsc(rev.operator || '—') + '　·　' + bgDt(rev.created_time) + '</div>'
      + (rev.note ? '<div class="blog-tlm">' + bgEsc(rev.note) + '</div>' : '')
      + '<div class="blog-tla"><button onclick="blogViewRev(' + rev.id + ')">檢視這一版</button>'
      +   (canRestore ? '<button onclick="blogRestoreRev(' + rev.id + ')">還原到這一版</button>' : '') + '</div>'
      + '</div></div>';
  }).join('');
}
function blogCloseDrawer(){
  ['blog-mask','blog-dw'].forEach(function(id){ var e = document.getElementById(id); if (e) e.remove(); });
}
function blogViewRev(revId){
  var rev = BLOG_REVS.filter(function(x){ return x.id === revId; })[0];
  if (!rev) return;
  var s = rev.snapshot || {};
  var blocks = ((s.content && s.content.blocks) || []);
  var txt = blocks.map(function(b){
    if (b.type === 'heading')   return '【' + (b.text || '') + '】';
    if (b.type === 'paragraph') return String(b.html || '').replace(/<[^>]*>/g, '');
    if (b.type === 'quote')     return '「' + (b.text || '') + '」';
    if (b.type === 'list')      return (b.items || []).map(function(x){ return '· ' + String(x).replace(/<[^>]*>/g,''); }).join('\n');
    if (b.type === 'image')     return '［圖片］' + (b.caption || '');
    if (b.type === 'video')     return '［影片］' + (b.caption || '');
    if (b.type === 'carousel')  return '［輪播 ' + ((b.items || []).length) + ' 張］';
    if (b.type === 'divider')   return '───';
    return '';
  }).filter(Boolean).join('\n\n');

  var m = document.createElement('div');
  m.id = 'blog-rev-modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9996;display:flex;align-items:center;justify-content:center;padding:30px;';
  m.onclick = function(e){ if (e.target === m) m.remove(); };
  m.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:720px;width:100%;max-height:82vh;display:flex;flex-direction:column;overflow:hidden">'
    + '<div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center">'
    +   '<div style="font-family:Syne,sans-serif;font-weight:700">第 ' + rev.revision_no + ' 版　·　' + bgDt(rev.created_time) + '</div>'
    +   '<div style="margin-left:auto;cursor:pointer;color:var(--text-dim)" onclick="document.getElementById(\'blog-rev-modal\').remove()">✕</div></div>'
    + '<div style="padding:20px 24px;overflow-y:auto;font-size:13.5px;line-height:2;color:var(--text-mid)">'
    +   '<div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">' + bgEsc(s.title || '') + '</div>'
    +   '<div style="color:var(--text-dim);margin-bottom:16px">' + bgEsc(s.summary || '') + '</div>'
    +   '<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:2">' + bgEsc(txt) + '</pre>'
    + '</div></div>';
  document.body.appendChild(m);
}
async function blogRestoreRev(revId){
  var rev = BLOG_REVS.filter(function(x){ return x.id === revId; })[0];
  if (!rev) return;
  if (!confirm('確定要把文章內容還原到第 ' + rev.revision_no + ' 版嗎？\n目前的內容會被覆蓋（但仍然會留在異動紀錄裡）。')) return;
  var s = rev.snapshot || {};
  var patch = {
    title:s.title, summary:s.summary, cover_url:s.cover_url, cover_source:s.cover_source,
    category:s.category, tags:s.tags || [], gallery:s.gallery || [], gallery_ratio:s.gallery_ratio || '16:9',
    content:s.content || { v:1, blocks:[] }, meta_title:s.meta_title, meta_description:s.meta_description,
    updated_by: bgMe()
  };
  var r = await sb.from('blog_posts').update(patch).eq('id', rev.post_id);
  if (r.error){ bgToast('還原失敗：' + r.error.message, 'err'); return; }
  try { await sb.rpc('blog_log_revision', { p_post_id:rev.post_id, p_action:'restore', p_note:'還原到第 ' + rev.revision_no + ' 版', p_operator:bgMe() }); } catch(e){}
  bgToast('已還原');
  blogCloseDrawer();
  await loadBlogPosts();
}

/* ═══ 燈箱 ═══════════════════════════════════════════════════════════ */
function blogLightbox(url, cap){
  if (!url) return;
  var lb = document.getElementById('blog-lb');
  if (!lb){
    lb = document.createElement('div');
    lb.id = 'blog-lb'; lb.className = 'blog-lb';
    lb.innerHTML = '<div class="blog-lbx" onclick="blogCloseLb()">×</div><div><img id="blog-lb-img" alt=""><div class="blog-lbc" id="blog-lb-cap"></div></div>';
    lb.addEventListener('click', function(e){ if (e.target === lb) blogCloseLb(); });
    document.body.appendChild(lb);
  }
  document.getElementById('blog-lb-img').src = url;
  document.getElementById('blog-lb-cap').textContent = cap || '';
  lb.classList.add('blog-on');
}
function blogCloseLb(){
  var lb = document.getElementById('blog-lb');
  if (lb) lb.classList.remove('blog-on');
}
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape'){ blogCloseLb(); blogHideSlash(); blogHideBMenu(); blogHideRowMenu(); }
});


/* ═══════════════════════════════════════════════════════════════════════
   編輯器
   ═══════════════════════════════════════════════════════════════════════ */

function blogBlank(){
  return {
    id:null, slug:'', title:'', summary:'', cover_url:'', cover_source:'',
    category:(BLOG_CATS[0] && BLOG_CATS[0].slug) || null, tags:[],
    gallery:[], gallery_ratio:'16:9',
    content:{ v:1, blocks:[] }, status:'draft', is_pinned:false,
    created_by:bgMe(), updated_by:'', published_by:'',
    created_time:null, updated_time:null, published_at:null
  };
}

function openBlogEditor(id){
  blogInjectStyle();
  BLOG_DIRTY = false;
  if (id == null){
    if (!bgIsAdmin()){ bgToast('只有管理員可以新增文章', 'err'); return; }
    BLOG_EDIT = blogBlank();
  } else {
    var p = blogFind(id);
    if (!p){ bgToast('找不到這篇文章', 'err'); return; }
    BLOG_EDIT = JSON.parse(JSON.stringify(p));
    if (!BLOG_EDIT.content || !BLOG_EDIT.content.blocks) BLOG_EDIT.content = { v:1, blocks:[] };
    if (!Array.isArray(BLOG_EDIT.gallery)) BLOG_EDIT.gallery = [];
    if (!Array.isArray(BLOG_EDIT.tags))    BLOG_EDIT.tags = [];
  }
  // 手機：只做應急功能，不開編輯器
  if (window.innerWidth < 820 && BLOG_EDIT.status !== 'published'){
    if (!confirm('文章編輯建議在電腦上操作，手機版的排版與插入功能會很難按。\n\n仍要繼續嗎？')) return;
  }
  blogRenderEditor();
  blogHistInit();                       // 進編輯器就把「原始狀態」記成第一步
  var main = document.getElementById('main-content');
  if (main) main.scrollTop = 0;
}

function blogBackToList(){
  if (BLOG_DIRTY && !confirm('有尚未儲存的變更，確定要離開嗎？')) return;
  BLOG_EDIT = null; BLOG_DIRTY = false;
  blogHistClear();
  renderBlogList();
}

/* ═══ 復原 / 重做 ═════════════════════════════════════════════════════
   每個區塊都是獨立的 contenteditable，瀏覽器內建的 Cmd+Z 只在單一區塊
   內有效，而且刪除區塊、轉換型別、換圖這些操作根本不在它的紀錄裡。
   所以這裡自己做一份：把整個編輯器的狀態拍成快照，堆成一個堆疊。
   打字的快照會延遲合併（不會每敲一個字就存一步），點擊類的操作則立刻存。 */

var BLOG_HIST = { stack:[], idx:-1, timer:null, busy:false, max:80 };

/* 目前整個編輯器的狀態（含內文 DOM）壓成字串 */
function blogHistState(){
  var e = BLOG_EDIT;
  if (!e) return null;
  return JSON.stringify({
    title:e.title || '', slug:e.slug || '', summary:e.summary || '',
    cover_url:e.cover_url || '', cover_source:e.cover_source || '',
    category:e.category || '', is_pinned:!!e.is_pinned,
    tags:e.tags || [], gallery:e.gallery || [], gallery_ratio:e.gallery_ratio || '16:9',
    blocks: document.getElementById('blog-doc') ? blogReadDoc(true) : ((e.content && e.content.blocks) || [])
  });
}

/* 游標位置：第幾個區塊 + 該區塊純文字的第幾個字 */
function blogCaretMark(){
  var doc = document.getElementById('blog-doc');
  var s = window.getSelection();
  if (!doc || !s || !s.rangeCount || !s.anchorNode) return null;
  var el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode;
  if (!el || !el.closest || !doc.contains(el)) return null;
  var c = el.closest('.blog-c');
  if (!c) return null;
  var bi = Array.prototype.indexOf.call(doc.children, c.closest('.blog-nb'));
  if (bi < 0) return null;
  try {
    var r = document.createRange();
    r.selectNodeContents(c);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return { bi:bi, off:r.toString().length };
  } catch(err){ return { bi:bi, off:0 }; }
}
function blogCaretRestore(m){
  if (!m) return;
  var doc = document.getElementById('blog-doc');
  if (!doc) return;
  var nb = doc.children[m.bi];
  if (!nb) return;
  var c = nb.querySelector('.blog-c[contenteditable="true"]');
  if (!c) return;
  var rem = m.off, node = null, t;
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null);
  while ((t = w.nextNode())){
    if (rem <= t.nodeValue.length){ node = t; break; }
    rem -= t.nodeValue.length;
  }
  var r = document.createRange();
  if (node) r.setStart(node, rem);
  else { r.selectNodeContents(c); r.collapse(false); }
  r.collapse(true);
  var s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
  c.focus();
}

function blogHistClear(){
  if (BLOG_HIST.timer) clearTimeout(BLOG_HIST.timer);
  BLOG_HIST = { stack:[], idx:-1, timer:null, busy:false, max:80 };
}
function blogHistInit(){
  blogHistClear();
  var s = blogHistState();
  if (s != null){ BLOG_HIST.stack = [{ s:s, c:null }]; BLOG_HIST.idx = 0; }
  blogHistBtns();
}

function blogHistPush(now){
  if (BLOG_HIST.busy || !BLOG_EDIT) return;
  if (BLOG_HIST.timer){ clearTimeout(BLOG_HIST.timer); BLOG_HIST.timer = null; }
  var run = function(){
    BLOG_HIST.timer = null;
    var s = blogHistState();
    if (s == null) return;
    var cur = BLOG_HIST.stack[BLOG_HIST.idx];
    if (cur && cur.s === s){ blogHistBtns(); return; }   // 內容沒變就不佔一步
    BLOG_HIST.stack = BLOG_HIST.stack.slice(0, BLOG_HIST.idx + 1);
    BLOG_HIST.stack.push({ s:s, c:blogCaretMark() });
    if (BLOG_HIST.stack.length > BLOG_HIST.max) BLOG_HIST.stack.shift();
    BLOG_HIST.idx = BLOG_HIST.stack.length - 1;
    blogHistBtns();
  };
  if (now) run();
  else {
    BLOG_HIST.timer = setTimeout(run, 550);      // 連續打字合併成一步
    blogHistBtns();                              // 但按鈕要立刻可按，不用等這半秒
  }
}

/* 所有會改到文章的地方都走這兩個，順便把「未儲存」旗標一起管掉 */
function blogTouch(){    BLOG_DIRTY = true; blogHistPush(false); }
function blogTouchNow(){ BLOG_DIRTY = true; blogHistPush(true);  }

function blogHistApply(){
  var it = BLOG_HIST.stack[BLOG_HIST.idx];
  if (!it || !BLOG_EDIT) return;
  var st;
  try { st = JSON.parse(it.s); } catch(e){ return; }
  BLOG_HIST.busy = true;
  var sc = document.querySelector('.main');
  var top = sc ? sc.scrollTop : 0;
  var e = BLOG_EDIT;
  e.title = st.title; e.slug = st.slug; e.summary = st.summary;
  e.cover_url = st.cover_url || null; e.cover_source = st.cover_source || null;
  e.category = st.category || null; e.is_pinned = st.is_pinned;
  e.tags = st.tags; e.gallery = st.gallery; e.gallery_ratio = st.gallery_ratio;
  e.content = { v:1, blocks: st.blocks };
  blogHideFmt();
  blogRenderEditor();
  if (sc) sc.scrollTop = top;
  blogCaretRestore(it.c);
  BLOG_DIRTY = true;
  BLOG_HIST.busy = false;
  blogHistBtns();
}

function blogUndo(){
  if (!BLOG_EDIT || blogEditorLocked()) return;
  blogHistPush(true);                       // 先把還沒定案的打字補成一步
  if (BLOG_HIST.idx <= 0){ bgToast('已經回到最早的狀態了'); return; }
  BLOG_HIST.idx--;
  blogHistApply();
}
function blogRedo(){
  if (!BLOG_EDIT || blogEditorLocked()) return;
  if (BLOG_HIST.timer){ clearTimeout(BLOG_HIST.timer); BLOG_HIST.timer = null; }
  if (BLOG_HIST.idx >= BLOG_HIST.stack.length - 1){ bgToast('沒有可以重做的步驟'); return; }
  BLOG_HIST.idx++;
  blogHistApply();
}
function blogEditorLocked(){
  return !BLOG_EDIT || BLOG_EDIT.status === 'published' || !bgIsAdmin();
}

function blogHistBtns(){
  var u = document.getElementById('blog-undo');
  var r = document.getElementById('blog-redo');
  var pending = !!BLOG_HIST.timer;
  if (u) u.disabled = !(BLOG_HIST.idx > 0 || pending);
  if (r) r.disabled = BLOG_HIST.idx >= BLOG_HIST.stack.length - 1;
}

/* Cmd/Ctrl+Z 復原、Cmd+Shift+Z 或 Ctrl+Y 重做。
   在 input / textarea 裡不攔截 —— 那些欄位瀏覽器自己的復原就夠用，
   攔下來反而會把單一欄位的逐字復原弄壞。 */
document.addEventListener('keydown', function(ev){
  if (!BLOG_EDIT || !(ev.metaKey || ev.ctrlKey)) return;
  var k = (ev.key || '').toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  var t = ev.target;
  var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea') return;
  ev.preventDefault();
  if (k === 'y' || ev.shiftKey) blogRedo(); else blogUndo();
});

function blogRenderEditor(){
  var e = BLOG_EDIT;
  var main = document.getElementById('main-content');
  if (!main || !e) return;
  var locked = (e.status === 'published');
  var st = BLOG_STATUS[e.status] || BLOG_STATUS.draft;
  var isAdmin = bgIsAdmin();
  var ro = locked || !isAdmin;

  var acts = locked
    ? '<button class="btn btn-secondary" onclick="blogHistory(' + e.id + ')">檢視異動紀錄</button>'
      + '<button class="btn btn-secondary" onclick="blogPreview(' + e.id + ')">在官網開啟</button>'
      + '<button class="btn btn-primary" disabled>儲存變更</button>'
    : '<button class="btn btn-secondary" onclick="blogSaveDraft()">儲存草稿</button>'
      + (e.id ? '<button class="btn btn-secondary" onclick="blogPreview(' + e.id + ')"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 10s3.5-5.5 9-5.5S19 10 19 10s-3.5 5.5-9 5.5S1 10 1 10z"/><circle cx="10" cy="10" r="2.4"/></svg> 預覽</button>' : '')
      + '<button class="btn btn-primary" onclick="blogPublishFromEditor()"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3v9m0-9l3 3m-3-3L7 6"/><path d="M4 13v3a1 1 0 001 1h10a1 1 0 001-1v-3"/></svg> 發佈文章</button>';

  main.innerHTML =
    '<div class="blog-ed-top">'
    + '<div class="blog-back" onclick="blogBackToList()"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4l-6 6 6 6"/></svg>返回列表</div>'
    + '<div class="blog-sep"></div>'
    + (ro ? '' : '<div class="blog-undos">'
        + '<button id="blog-undo" class="blog-ur" onclick="blogUndo()" title="復原上一動（⌘Z）" disabled>'
        +   '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7H12.5a4 4 0 010 8H8" stroke-linecap="round"/><path d="M9.5 4L6.5 7l3 3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
        + '<button id="blog-redo" class="blog-ur" onclick="blogRedo()" title="重做（⌘⇧Z）" disabled>'
        +   '<svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 7H7.5a4 4 0 000 8H12" stroke-linecap="round"/><path d="M10.5 4l3 3-3 3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
        + '</div><div class="blog-sep"></div>')
    + '<span class="blog-bd ' + st.cls + '"><i></i>' + st.label + '</span>'
    + '<div class="blog-auto" id="blog-savemsg">' + (e.id ? '<i></i>已儲存 · ' + bgDt(e.updated_time) : '尚未儲存') + '</div>'
    + '<div class="blog-acts">' + acts + '</div>'
    + '</div>'
    + (locked ? blogLockBanner(e) : '')
    + blogCardSettings(ro)
    + blogCardGallery(ro)
    + blogCardDoc(ro);

  blogEnsureMenus();
  blogBindDoc();
  blogHistBtns();
}

function blogLockBanner(e){
  return '<div class="blog-lock">'
    + '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" style="flex:none"><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6a3 3 0 016 0v3"/></svg>'
    + '<div><b>這篇文章正在官網上發佈中，因此不可編輯。</b>　需要修改請先按「下架」，狀態會轉為「已下架」，'
    + '官網上這篇的網址會顯示「這篇文章維護中，下次再來看看吧！」而不是 404，已分享出去的連結不會失效。'
    + '修改完成後再按「重新發佈」即可，整個過程都會留下紀錄。</div>'
    + (bgIsAdmin() ? '<button class="btn btn-primary" style="background:#d97706;margin-left:auto" onclick="blogUnpublish(' + e.id + ')">'
        + '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 17V8m0 0L7 11m3-3l3 3"/><path d="M4 6V4a1 1 0 011-1h10a1 1 0 011 1v2"/></svg> 下架以進行修改</button>' : '')
    + '</div>';
}

/* ── 1 文章設定 ─────────────────────────────────────────────────── */
function blogCardSettings(ro){
  var e = BLOG_EDIT;
  var d = ro ? ' disabled' : '';
  var catOpts = '<option value="">未分類</option>' + BLOG_CATS.map(function(c){
    return '<option value="' + bgEsc(c.slug) + '"' + (e.category === c.slug ? ' selected' : '') + '>' + bgEsc(c.name) + '</option>';
  }).join('');

  return '<div class="blog-card' + (ro ? ' blog-locked' : '') + '">'
  + '<div class="blog-ch"><span class="blog-n">1</span>文章設定' + (ro ? '<span class="blog-sub">唯讀</span>' : '') + '</div>'
  + '<div class="blog-row"><label>標題<b>*</b></label><div>'
  +   '<input class="blog-i blog-big" id="blog-f-title" value="' + bgEsc(e.title) + '" placeholder="輸入文章標題…" oninput="blogField(\'title\',this.value)"' + d + '>'
  + '</div></div>'
  + '<div class="blog-row"><label>網址代稱<b>*</b></label><div>'
  +   '<div style="display:flex;gap:8px;align-items:center">'
  +     '<input class="blog-i" id="blog-f-slug" style="font-family:Inter,monospace;font-size:13px" value="' + bgEsc(e.slug) + '" placeholder="cross-border-tariff" oninput="blogField(\'slug\',this.value)"' + d + '>'
  +     (ro ? '' : '<button class="btn btn-secondary" style="white-space:nowrap" onclick="blogGenSlug()">自動產生</button>')
  +   '</div>'
  +   '<div class="blog-hint" id="blog-slug-hint">文章網址將是 <b>' + BLOG_SITE + '/blog/' + bgEsc(e.slug || '…') + '/</b>　·　按「自動產生」會把中文標題翻成英文，翻不出來就退回日期加編號，隨時可以手動改。</div>'
  + '</div></div>'
  + '<div class="blog-row"><label>分類</label><div class="blog-f3">'
  +   '<select class="blog-i" onchange="blogField(\'category\',this.value||null)"' + d + '>' + catOpts + '</select>'
  +   '<div class="blog-chk' + (e.is_pinned ? ' blog-on' : '') + '" onclick="' + (ro ? '' : 'blogTogglePin(this)') + '"><i></i>置頂</div>'
  + '</div></div>'
  + '<div class="blog-row"><label>標籤</label><div>'
  +   '<div class="blog-tagbox" id="blog-tagbox">' + blogTagChips(ro) + '</div>'
  +   '<div class="blog-hint" id="blog-tag-hint">已使用 <b>' + e.tags.length + ' / 3</b>' + (e.tags.length >= 3 ? '，要換標籤請先移除一個。' : '，輸入後按 Enter 新增（用注音／拼音時，第一次 Enter 是選字，再按一次才會加入）。') + '　標籤在官網上只顯示、不可點，但讀者用列表頁的搜尋框可以搜到。</div>'
  +   blogTagSuggest(ro)
  + '</div></div>'
  + '<div class="blog-row"><label>操作紀錄</label><div>'
  +   '<div class="blog-meta">'
  +     '<div><div class="blog-k">建立者</div><div class="blog-v">' + bgEsc(e.created_by || bgMe()) + ' · ' + bgDate(e.created_time) + '</div></div>'
  +     '<div><div class="blog-k">最後編輯</div><div class="blog-v">' + bgEsc(e.updated_by || '—') + ' · ' + bgDt(e.updated_time) + '</div></div>'
  +     '<div><div class="blog-k">上次發佈者</div><div class="blog-v">' + bgEsc(e.published_by || '—') + ' · ' + bgDate(e.published_at) + '</div></div>'
  +   '</div>'
  +   '<div class="blog-eye"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" style="flex:none"><path d="M3 3l14 14"/><path d="M8 5.2A7 7 0 0110 5c5.5 0 9 5 9 5a15 15 0 01-3 3.3M5.5 5.9A15 15 0 001 10s3.5 5 9 5a8 8 0 003.2-.7"/></svg>'
  +   '這幾筆只有後台看得到，系統自動記錄不用填。<b>官網上的文章不顯示作者</b>，對外統一是 GC 官網的文章。</div>'
  + '</div></div>'
  + '<div class="blog-row"><label>摘要<b>*</b></label><div>'
  +   '<textarea class="blog-i" id="blog-f-summary" placeholder="兩三句話說明這篇在講什麼…" oninput="blogField(\'summary\',this.value);blogSummaryCount()"' + d + '>' + bgEsc(e.summary) + '</textarea>'
  +   '<div class="blog-hint" id="blog-sum-hint"></div>'
  + '</div></div>'
  + '<div class="blog-row"><label>封面圖<b>*</b></label><div>'
  +   '<div class="blog-cover">'
  +     '<div class="blog-cover-pv" id="blog-cover-pv"' + (e.cover_url ? ' style="background-image:url(\'' + bgEsc(e.cover_url) + '\')"' : '') + ' onclick="blogLightbox(BLOG_EDIT.cover_url,\'封面圖\')"></div>'
  +     '<div class="blog-cover-side">'
  +       (ro ? '' : '<div style="display:flex;gap:8px"><button class="btn btn-secondary" onclick="blogPickCover()">' + (e.cover_url ? '更換圖片' : '上傳圖片') + '</button>'
  +         + (e.cover_url ? '<button class="btn btn-ghost" onclick="blogClearCover()">移除</button>' : '') + '</div>')
  +       '<div class="blog-hint">建議 1200 × 630 px　·　<b>內頁最上方不顯示封面大圖</b>，這張只用於列表卡片縮圖與分享到 LINE / FB 的預覽圖。點縮圖可放大檢視。</div>'
  +     '</div>'
  +   '</div>'
  +   '<div class="blog-srcf">'
  +     '<div class="blog-sl"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>圖片來源（可留空）</div>'
  +     '<input class="blog-i" value="' + bgEsc(e.cover_source) + '" placeholder="例如：Unsplash / 品牌方提供 / AI 生成 / 自行拍攝" oninput="blogField(\'cover_source\',this.value)"' + d + '>'
  +     '<div class="blog-hint">留空的話，官網上就不會出現來源那一行。</div>'
  +   '</div>'
  + '</div></div>'
  + '</div>';
}

function blogSummaryCount(){
  var el = document.getElementById('blog-sum-hint');
  if (!el) return;
  var n = (BLOG_EDIT.summary || '').length;
  el.className = 'blog-hint' + (n > 0 && n <= 120 ? ' blog-ok2' : (n > 120 ? ' blog-warn' : ''));
  el.innerHTML = n + ' / 120 字　·　會顯示在列表卡片，同時作為 Google 搜尋結果的描述文字' + (n > 120 ? '（超過 120 字 Google 會截斷）' : '');
}

function blogTagChips(ro){
  var e = BLOG_EDIT;
  var chips = e.tags.map(function(t, i){
    return '<span class="blog-tg">#' + bgEsc(t) + (ro ? '' : ' <i onclick="blogRemoveTag(' + i + ')">×</i>') + '</span>';
  }).join('');
  if (!ro && e.tags.length < 3){
    chips += '<input id="blog-tag-input" placeholder="輸入標籤後按 Enter…" list="blog-tag-list" onkeydown="blogTagKey(event)">'
          +  '<datalist id="blog-tag-list">' + BLOG_TAGS.map(function(t){ return '<option value="' + bgEsc(t) + '">'; }).join('') + '</datalist>';
  }
  return chips;
}
function blogTagSuggest(ro){
  if (ro || !BLOG_TAGS.length) return '';
  var full = BLOG_EDIT.tags.length >= 3;
  return '<div class="blog-sugs"><span style="font-size:11.5px;color:var(--text-dim)">常用：</span>'
    + BLOG_TAGS.slice(0, 8).map(function(t){
        var used = BLOG_EDIT.tags.indexOf(t) >= 0;
        return '<span class="blog-sg' + (full || used ? ' blog-off' : '') + '"' + (full || used ? '' : ' onclick="blogAddTag(\'' + bgEsc(t).replace(/'/g,"\\'") + '\')"') + '>#' + bgEsc(t) + '</span>';
      }).join('') + '</div>';
}
/* ── 中文輸入法的 Enter ───────────────────────────────────────────
   用注音／拼音打字時，第一次 Enter 是「選字／保留字」，不能當成送出。
   組字中的 keydown 會帶 isComposing（舊瀏覽器是 keyCode 229）；
   但有些輸入法（尤其 Windows）會先送 compositionend 再送 keydown，
   那一瞬間 isComposing 已經是 false，所以再補一個極短的緩衝時間。
   80ms 足以吃掉同一輪事件的順序差，又短到不會擋住使用者刻意的第二次 Enter。 */
var _blogCompEnd = 0;
document.addEventListener('compositionend', function(){ _blogCompEnd = Date.now(); }, true);
function blogImeBusy(ev){
  if (ev && (ev.isComposing || ev.keyCode === 229)) return true;
  return (Date.now() - _blogCompEnd) < 80;
}

function blogTagKey(ev){
  if (ev.key !== 'Enter' && ev.key !== ',') return;
  if (blogImeBusy(ev)) return;          // 這一下是在選字，讓輸入法自己處理
  ev.preventDefault();
  var v = (ev.target.value || '').trim().replace(/^#/, '');
  if (!v) return;
  ev.target.value = '';
  blogAddTag(v);
}
function blogAddTag(t){
  t = String(t || '').trim().replace(/^#/, '');
  if (!t) return;
  if (BLOG_EDIT.tags.length >= 3){ bgToast('標籤最多 3 個', 'err'); return; }
  if (BLOG_EDIT.tags.indexOf(t) >= 0){ bgToast('這個標籤已經加過了', 'err'); return; }
  BLOG_EDIT.tags.push(t);
  blogTouchNow();
  blogRefreshTags();
}
function blogRemoveTag(i){
  BLOG_EDIT.tags.splice(i, 1);
  blogTouchNow();
  blogRefreshTags();
}
function blogRefreshTags(){
  var box = document.getElementById('blog-tagbox');
  if (box) box.innerHTML = blogTagChips(false);
  var hint = document.getElementById('blog-tag-hint');
  if (hint) hint.innerHTML = '已使用 <b>' + BLOG_EDIT.tags.length + ' / 3</b>'
    + (BLOG_EDIT.tags.length >= 3 ? '，要換標籤請先移除一個。' : '，輸入後按 Enter 新增（用注音／拼音時，第一次 Enter 是選字，再按一次才會加入）。')
    + '　標籤在官網上只顯示、不可點，但讀者用列表頁的搜尋框可以搜到。';
  var sug = document.querySelector('.blog-sugs');
  if (sug) sug.outerHTML = blogTagSuggest(false);
  var inp = document.getElementById('blog-tag-input');
  if (inp) inp.focus();
}

function blogField(k, v){ BLOG_EDIT[k] = v; blogTouch(); if (k === 'slug') blogSlugHint(); }
function blogSlugHint(){
  var el = document.getElementById('blog-slug-hint');
  if (!el) return;
  var s = BLOG_EDIT.slug || '';
  var bad = s && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
  el.className = 'blog-hint' + (bad ? ' blog-warn' : '');
  el.innerHTML = bad
    ? '⚠ 網址代稱只能用小寫英文、數字與連字號（例如 <b>cross-border-tariff</b>），中文或大寫會存不進去。'
    : '文章網址將是 <b>' + BLOG_SITE + '/blog/' + bgEsc(s || '…') + '/</b>　·　按「自動產生」會把中文標題翻成英文，翻不出來就退回日期加編號，隨時可以手動改。';
}
function blogTogglePin(el){
  BLOG_EDIT.is_pinned = !BLOG_EDIT.is_pinned;
  blogTouchNow();
  el.classList.toggle('blog-on', BLOG_EDIT.is_pinned);
}

/* ── slug 自動產生（翻譯 → 日期編號 → 唯一化） ─────────────────── */
function blogSlugify(s){
  return String(s || '')
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-').filter(Boolean).slice(0, 9).join('-');
}
function blogDateSlug(){
  var d = new Date();
  var p = function(n){ return (n < 10 ? '0' : '') + n; };
  var base = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  var used = BLOG_DB.filter(function(x){ return String(x.slug).indexOf(base) === 0; }).length;
  return base + '-' + p(used + 1);
}
async function blogTranslateSlug(title){
  if (!title) return { slug:'', via:'' };
  // 已經是純英數就直接用，不用麻煩伺服器
  if (/^[\x20-\x7E]+$/.test(title)) return { slug: blogSlugify(title), via:'passthrough' };
  try {
    var ctl = ('AbortSignal' in window && AbortSignal.timeout) ? { signal: AbortSignal.timeout(8000) } : {};
    var res = await fetch('/.netlify/functions/blog-slug?q=' + encodeURIComponent(title), ctl);
    if (!res.ok) return { slug:'', via:'' };
    var j = await res.json();
    return { slug: blogSlugify(j && j.slug), via: (j && j.via) || '' };
  } catch(e){ return { slug:'', via:'' }; }
}
async function blogUniqueSlug(base){
  if (!base) return '';
  var exists = {};
  BLOG_DB.forEach(function(p){ if (!BLOG_EDIT || p.id !== BLOG_EDIT.id) exists[p.slug] = true; });
  var r = await sb.from('blog_posts').select('slug');
  ((r && r.data) || []).forEach(function(p){ if (!BLOG_EDIT || p.slug !== BLOG_EDIT.slug) exists[p.slug] = true; });
  if (!exists[base]) return base;
  for (var i = 2; i < 60; i++){ if (!exists[base + '-' + i]) return base + '-' + i; }
  return base + '-' + Date.now();
}
async function blogGenSlug(){
  if (!String(BLOG_EDIT.title || '').trim()){ bgToast('請先輸入標題，才有東西可以轉成網址。', 'err'); return; }
  var hint = document.getElementById('blog-slug-hint');
  if (hint){ hint.className = 'blog-hint'; hint.textContent = '產生中…'; }
  var r = await blogTranslateSlug(BLOG_EDIT.title);
  var s = r.slug, via = r.via;
  if (!s){ s = blogDateSlug(); via = 'date'; }
  s = await blogUniqueSlug(s);
  BLOG_EDIT.slug = s;
  blogTouchNow();
  var inp = document.getElementById('blog-f-slug');
  if (inp) inp.value = s;
  blogSlugHint();
  if (via === 'pinyin')    bgToast('翻譯服務沒有回應，先用拼音轉寫。可以直接改成想要的英文網址。');
  else if (via === 'date') bgToast('翻譯與拼音都取不到，先用日期加編號。可以直接改成想要的英文網址。');
}

/* ── 圖片上傳（驗證 + 縮圖 + 上傳） ──────────────────────────────── */
function blogFileErr(file){
  var name = String(file.name || '').toLowerCase();
  if (/\.(heic|heif)$/.test(name) || /heic|heif/.test(file.type || ''))
    return '「' + file.name + '」是 iPhone 的 HEIC 格式，多數瀏覽器顯示不出來。請在手機上改成「最相容」拍攝，或先轉成 JPG 再上傳。';
  var okType = /^image\/(jpeg|png|webp)$/.test(file.type || '') || /\.(jpe?g|png|webp)$/.test(name);
  if (!okType) return '「' + file.name + '」不是支援的格式。只收 JPG、PNG、WebP。';
  if (file.size > BLOG_MAX_MB * 1024 * 1024)
    return '「' + file.name + '」有 ' + (file.size / 1048576).toFixed(1) + ' MB，超過 ' + BLOG_MAX_MB + ' MB 上限。請先壓縮再上傳。';
  return '';
}
function blogShrink(file){
  return new Promise(function(resolve){
    if (typeof createImageBitmap !== 'function' || !document.createElement('canvas').getContext){
      resolve({ blob:file, w:0, h:0 }); return;
    }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function(){
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w <= BLOG_MAX_PX){ URL.revokeObjectURL(url); resolve({ blob:file, w:w, h:h }); return; }
      var nh = Math.round(h * BLOG_MAX_PX / w);
      var cv = document.createElement('canvas');
      cv.width = BLOG_MAX_PX; cv.height = nh;
      cv.getContext('2d').drawImage(img, 0, 0, BLOG_MAX_PX, nh);
      cv.toBlob(function(b){
        URL.revokeObjectURL(url);
        resolve({ blob: b || file, w:BLOG_MAX_PX, h:nh });
      }, 'image/jpeg', 0.88);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); resolve({ blob:file, w:0, h:0 }); };
    img.src = url;
  });
}
async function blogEnsurePost(){
  if (BLOG_EDIT.id) return BLOG_EDIT.id;
  if (!BLOG_EDIT.slug) BLOG_EDIT.slug = await blogUniqueSlug(blogDateSlug());
  var r = await sb.from('blog_posts').insert({
    slug: BLOG_EDIT.slug, title: BLOG_EDIT.title || '', summary: BLOG_EDIT.summary || '',
    category: BLOG_EDIT.category || null, tags: BLOG_EDIT.tags || [],
    status: 'draft', created_by: bgMe(), updated_by: bgMe()
  }).select().single();
  if (r.error){ bgToast('建立草稿失敗：' + r.error.message, 'err'); return null; }
  BLOG_EDIT.id = r.data.id;
  BLOG_EDIT.created_time = r.data.created_time;
  try { await sb.rpc('blog_log_revision', { p_post_id:r.data.id, p_action:'create', p_note:null, p_operator:bgMe() }); } catch(e){}
  return BLOG_EDIT.id;
}
async function blogUpload(file){
  var err = blogFileErr(file);
  if (err){ bgToast(err, 'err'); return null; }
  var pid = await blogEnsurePost();
  if (!pid) return null;
  var out = await blogShrink(file);
  var safe = String(file.name || 'img').replace(/[^\w.\-]/g, '_');
  var path = 'posts/' + pid + '/' + Date.now() + '_' + safe;
  var up = await sb.storage.from(BLOG_BUCKET).upload(path, out.blob, { upsert:true, cacheControl:'3600' });
  if (up.error){ bgToast('上傳失敗：' + up.error.message, 'err'); return null; }
  var url = sb.storage.from(BLOG_BUCKET).getPublicUrl(path).data.publicUrl;
  return { url:url, w:out.w, h:out.h };
}
function blogPickFiles(multiple, cb){
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/jpeg,image/png,image/webp';
  if (multiple) inp.multiple = true;
  inp.onchange = function(){ cb(Array.prototype.slice.call(inp.files || [])); };
  inp.click();
}
function blogPickCover(){
  blogPickFiles(false, async function(files){
    if (!files.length) return;
    bgToast('上傳中…');
    var r = await blogUpload(files[0]);
    if (!r) return;
    BLOG_EDIT.cover_url = r.url;
    blogTouchNow();
    blogRenderEditor();
    bgToast('封面已上傳');
  });
}
function blogClearCover(){
  BLOG_EDIT.cover_url = '';
  blogTouchNow();
  blogRenderEditor();
}

/* ── 2 圖片區塊 ─────────────────────────────────────────────────── */
function blogCardGallery(ro){
  var e = BLOG_EDIT;
  var R = BLOG_RATIOS[e.gallery_ratio] || BLOG_RATIOS['16:9'];
  var ratios = [['16:9','blog-r169','16:9 寬幅'],['4:5','blog-r45','4:5 直式'],['1:1','blog-r11','1:1 方形']].map(function(r){
    return '<span class="blog-rb ' + r[1] + (e.gallery_ratio === r[0] ? ' blog-on' : '') + '"'
      + (ro ? '' : ' onclick="blogSetRatio(\'' + r[0] + '\')"') + '><b></b>' + r[2] + '</span>';
  }).join('');

  return '<div class="blog-card' + (ro ? ' blog-locked' : '') + '">'
  + '<div class="blog-ch"><span class="blog-n">2</span>圖片區塊<span class="blog-sub">' + e.gallery.length + ' 張　·　顯示在摘要下方的輪播</span></div>'
  + '<div class="blog-rp"><span class="blog-k2">顯示比例</span>' + ratios
  +   '<span style="margin-left:auto;font-size:11px;color:var(--text-dim)">這一組的每張圖都會統一裁成這個比例</span></div>'
  + '<div class="blog-note"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" style="flex:none"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M2 13l4-4 3.5 3 3-2.5L18 13"/></svg>'
  +   '<div>目前比例 <b>' + e.gallery_ratio + '</b>　·　建議上傳畫布 <b>' + R.canvas + '</b>（最小 ' + R.min + '）。<br>'
  +   '比這個比例更寬或更高的圖會被自動置中裁切，所以主體請盡量放在畫面中央。</div></div>'
  + '<div id="blog-slides">' + blogSlidesHtml(ro) + '</div>'
  + (ro ? '' :
      '<div class="blog-up">'
      + '<button class="btn btn-primary" onclick="blogBatchUpload()"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14V4m0 0L6 8m4-4l4 4"/><path d="M3 15v2h14v-2"/></svg> 批次上傳圖片</button>'
      + '<button class="btn btn-secondary" onclick="blogAddVideoSlide()"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="4" width="16" height="12" rx="2"/><path d="M8.5 8l4 2-4 2z" fill="currentColor" stroke="none"/></svg> 貼影片連結</button>'
      + '<span style="font-size:11.5px;color:var(--text-dim)">可一次選取多張，或把圖片拖進下面的區域，新的圖會接在清單最後面</span>'
      + '</div>'
      + '<div class="blog-dz" id="blog-dz" onclick="blogBatchUpload()">'
      + '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"/></svg>'
      + '<div>把圖片拖到這裡，或按上面的「批次上傳圖片」</div></div>')
  + '</div>';
}
function blogSlidesHtml(ro){
  var e = BLOG_EDIT;
  if (!e.gallery.length)
    return '<div style="padding:26px;text-align:center;color:var(--text-dim);font-size:12.5px;border:1px solid var(--border);border-radius:9px;background:#fafbfc">'
         + '還沒有圖片。這一組沒有內容的話，官網就整塊不顯示，不會留空白框。</div>';
  return e.gallery.map(function(g, i){
    var thumb = g.thumb || g.url;
    var isVid = g.kind === 'video';
    return '<div class="blog-slide">'
      + '<div class="blog-no">' + (i + 1) + '</div>'
      + '<div class="blog-sth"' + (thumb ? ' style="background-image:url(\'' + bgEsc(thumb) + '\')"' : '') + ' onclick="blogLightbox(\'' + bgEsc(thumb) + '\',\'' + bgEsc(g.caption || '') + '\')">'
      +   (isVid ? '<div class="blog-vp"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div><div class="blog-vt">' + bgEsc(g.platform || 'video') + '</div>' : '')
      + '</div>'
      + '<div>'
      +   (isVid ? '<div class="blog-sf"><label>連結</label><input class="blog-i" style="font-family:Inter,monospace;font-size:11.5px" value="' + bgEsc(g.url) + '" oninput="blogSlideUrl(' + i + ',this.value)"' + (ro ? ' disabled' : '') + '></div>' : '')
      +   '<div class="blog-sf"><label>圖說</label><input class="blog-i" value="' + bgEsc(g.caption || '') + '" placeholder="圖說（可留空）" oninput="blogSlideField(' + i + ',\'caption\',this.value)"' + (ro ? ' disabled' : '') + '></div>'
      +   '<div class="blog-sf blog-src"><label>來源</label><input class="blog-i" value="' + bgEsc(g.source || '') + '" placeholder="自製就留空 — 官網上這一行不會出現" oninput="blogSlideField(' + i + ',\'source\',this.value)"' + (ro ? ' disabled' : '') + '></div>'
      + '</div>'
      + (ro ? '<div></div>' : '<div class="blog-sops">'
      +   '<button title="上移" onclick="blogSlideMove(' + i + ',-1)">↑</button>'
      +   '<button title="下移" onclick="blogSlideMove(' + i + ',1)">↓</button>'
      +   '<button title="移除" class="blog-dg" onclick="blogSlideRemove(' + i + ')">×</button></div>')
      + '</div>';
  }).join('');
}
function blogSetRatio(r){ BLOG_EDIT.gallery_ratio = r; blogTouchNow(); blogRenderEditor(); }
function blogSlideField(i, k, v){ if (BLOG_EDIT.gallery[i]){ BLOG_EDIT.gallery[i][k] = v; blogTouch(); } }
function blogSlideUrl(i, v){
  var g = BLOG_EDIT.gallery[i]; if (!g) return;
  g.url = v; blogTouch();
  var info = blogParseVideo(v);
  if (info){ g.platform = info.platform; g.videoId = info.id; if (!g.thumbManual && info.thumb) g.thumb = info.thumb; }
}
function blogSlideMove(i, d){
  var a = BLOG_EDIT.gallery, j = i + d;
  if (j < 0 || j >= a.length) return;
  var t = a[i]; a[i] = a[j]; a[j] = t;
  blogTouchNow(); blogRenderEditor();
}
function blogSlideRemove(i){ BLOG_EDIT.gallery.splice(i, 1); blogTouchNow(); blogRenderEditor(); }
function blogBatchUpload(){
  blogPickFiles(true, async function(files){
    if (!files.length) return;
    await blogAddFilesToGallery(files);
  });
}
async function blogAddFilesToGallery(files){
  bgToast('上傳中… 共 ' + files.length + ' 張');
  var ok = 0;
  for (var i = 0; i < files.length; i++){
    var r = await blogUpload(files[i]);
    if (r){ BLOG_EDIT.gallery.push({ kind:'image', url:r.url, w:r.w, h:r.h, caption:'', source:'' }); ok++; }
  }
  blogTouchNow();
  blogRenderEditor();
  if (ok) bgToast('已加入 ' + ok + ' 張');
}
function blogAddVideoSlide(){
  var u = prompt('貼上影片連結（YouTube 或 Vimeo）：', '');
  if (!u) return;
  var info = blogParseVideo(u);
  if (!info){ bgToast('看不懂這個連結。YouTube 與 Vimeo 可自動抓縮圖；Facebook / Instagram 請改用「上傳圖片」自行放封面。', 'err'); return; }
  BLOG_EDIT.gallery.push({ kind:'video', url:u, platform:info.platform, videoId:info.id, thumb:info.thumb, thumbManual:false, caption:'', source:'' });
  blogTouchNow();
  blogRenderEditor();
}
function blogParseVideo(u){
  u = String(u || '');
  var m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (m) return { platform:'YouTube', id:m[1], thumb:'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { platform:'Vimeo', id:m[1], thumb:'' };
  return null;
}

/* ── 3 內文（Notion 式） ─────────────────────────────────────────── */
var BLOG_SLASH_ITEMS = [
  ['p',     '¶',  '段落',       '一般內文'],
  ['h2',    'H2', '大標題',     '章節標題'],
  ['h3',    'H3', '小標題',     '次層標題'],
  ['ul',    '•',  '項目清單',   '圓點條列'],
  ['ol',    '1.', '編號清單',   '有順序的條列'],
  ['quote', '❝',  '引言',       '強調一段話'],
  ['img',   '▣',  '圖片',       '維持原圖比例，不裁切'],
  ['vid',   '▶',  '影片',       '貼連結自動抓縮圖'],
  ['hr',    '—',  '分隔線',     '分段用']
];

function blogCardDoc(ro){
  return '<div class="blog-card' + (ro ? ' blog-locked' : '') + '">'
  + '<div class="blog-ch"><span class="blog-n">3</span>內文<span class="blog-sub" id="blog-wc"></span></div>'
  + (ro ? '' : '<div class="blog-dh">直接在下面的框裡打字。<b>按 <kbd>/</kbd> 是把「目前這一段」改成標題、清單、引言、圖片…</b>；'
      + '想在下面<b>另外加一段</b>，點該段左邊浮出的 <b>＋</b> 或用框最下面那排按鈕。<br>'
      + '<b>已經寫好的字要改格式：把它選起來</b>，上方會浮出工具列，可以轉成標題／引言／清單，或套用粗體、斜體、底線、刪除線、顏色、螢光筆與連結。<br>'
      + '<b>標題、引言、清單要改回內文</b>：把游標點進那一段，上方會浮出一排轉換鈕，按「內文」即可（也可以點左邊的 <kbd>⠿</kbd>）。<br>'
      + '<b>要刪除或搬動某一段：點該段左邊的 <kbd>⠿</kbd></b>。　打錯了按 <kbd>⌘Z</kbd> 復原。</div>')
  + '<div class="blog-docbox">'
  +   '<div class="blog-doc" id="blog-doc">' + blogBlocksToHtml(BLOG_EDIT.content.blocks || [], ro) + '</div>'
  +   (ro ? '' : '<div class="blog-foot">'
  +     '<span class="blog-fk">插入</span>'
  +     '<button class="btn btn-secondary" onclick="blogFootAdd(\'p\')">新增段落</button>'
  +     '<button class="btn btn-secondary" onclick="blogFootAdd(\'img\')">上傳圖片</button>'
  +     '<button class="btn btn-secondary" onclick="blogFootAdd(\'vid\')">貼影片連結</button>'
  +     '<span class="blog-fh">或在文件裡按 <kbd>/</kbd></span></div>')
  + '</div></div>';
}

/* 允許留下來的行內標籤。span 只准帶 color / background-color 兩種樣式，
   而且值必須是 #hex 或 rgb()/rgba() —— 其餘一律丟掉，避免有人把
   position / url() / expression 這類東西塞進文章內容。 */
var BLOG_INLINE_OK = ['b','strong','i','em','u','s','a','br','span','code'];

function blogSafeStyle(v){
  var out = [];
  String(v || '').split(';').forEach(function(part){
    var i = part.indexOf(':');
    if (i < 0) return;
    var k = part.slice(0, i).trim().toLowerCase();
    var val = part.slice(i + 1).trim();
    if (k !== 'color' && k !== 'background-color') return;
    if (!/^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i.test(val)) return;
    out.push(k + ':' + val);
  });
  return out.join(';');
}

/* 瀏覽器的 execCommand 有時會把粗體／斜體寫成 CSS（<span style="font-weight:bold">）
   而不是 <b>。這裡先統一換回標準標籤，否則下面的樣式過濾會把粗體一起洗掉。 */
var BLOG_TAG_OF = { b:'b', strong:'b', i:'i', em:'i', u:'u', s:'s', strike:'s', del:'s' };

function blogNormalizeStyles(root){
  Array.prototype.slice.call(root.querySelectorAll('[style],font')).forEach(function(n){
    if (!n.parentNode) return;
    var tag = n.tagName.toLowerCase();
    var stl = n.getAttribute('style') || '';
    if (tag === 'font'){
      var col = n.getAttribute('color');
      if (col) stl += ';color:' + col;
    }
    var self = BLOG_TAG_OF[tag] || '';
    var wraps = [];
    if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(stl) && self !== 'b') wraps.push('b');
    if (/font-style\s*:\s*italic/i.test(stl)                 && self !== 'i') wraps.push('i');
    if (/text-decoration[^;]*\bunderline\b/i.test(stl)       && self !== 'u') wraps.push('u');
    if (/text-decoration[^;]*line-through/i.test(stl)        && self !== 's') wraps.push('s');
    var keep = blogSafeStyle(stl);

    var core;
    if (tag === 'span' || tag === 'font'){
      // 這兩個標籤本身沒有語意，沒顏色可留就直接拆掉
      if (keep){
        var sp = document.createElement('span');
        sp.setAttribute('style', keep);
        while (n.firstChild) sp.appendChild(n.firstChild);
        core = sp;
      } else {
        core = document.createDocumentFragment();
        while (n.firstChild) core.appendChild(n.firstChild);
      }
    } else {
      // 其他標籤（b / i / u / s / a / code）要保留，只把樣式收斂成顏色
      if (keep) n.setAttribute('style', keep); else n.removeAttribute('style');
      if (!wraps.length) return;
      core = n;
    }

    var parent = n.parentNode, ref = n.nextSibling;
    if (core !== n) n.remove(); else { parent = n.parentNode; ref = n.nextSibling; n.remove(); }
    wraps.forEach(function(w){ var e = document.createElement(w); e.appendChild(core); core = e; });
    parent.insertBefore(core, ref);
  });
}

function blogSanitize(html){
  var d = document.createElement('div');
  d.innerHTML = String(html || '');
  blogNormalizeStyles(d);
  (function walk(node){
    Array.prototype.slice.call(node.childNodes).forEach(function(n){
      if (n.nodeType === 3) return;
      if (n.nodeType !== 1){ n.remove(); return; }
      var tag = n.tagName.toLowerCase();

      // <strike> / <del> 一律收斂成 <s>，官網那邊只要處理一種
      if (tag === 'strike' || tag === 'del'){
        var s2 = document.createElement('s');
        while (n.firstChild) s2.appendChild(n.firstChild);
        n.replaceWith(s2);
        n = s2; tag = 's';
      }

      // 這幾種連內容都不要留（<script>alert(1)</script> 不該變成文字「alert(1)」）
      if (['script','style','noscript','iframe','object','embed','template'].indexOf(tag) >= 0){ n.remove(); return; }
      if (BLOG_INLINE_OK.indexOf(tag) < 0){
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.remove(); return;
      }

      // 顏色可以掛在任何一個行內標籤上（瀏覽器會把 color 套在最近的那一層）
      var keepStyle = blogSafeStyle(n.getAttribute('style'));
      Array.prototype.slice.call(n.attributes).forEach(function(a){
        if (tag === 'a' && a.name === 'href'){
          if (!/^https?:\/\//i.test(a.value)) n.removeAttribute('href');
        } else n.removeAttribute(a.name);
      });
      if (tag === 'a'){ n.setAttribute('rel', 'noopener nofollow'); n.setAttribute('target', '_blank'); }
      if (keepStyle) n.setAttribute('style', keepStyle);
      else if (tag === 'span'){                  // 沒有顏色的空 span 就拆掉，別讓它一直累積
        walk(n);
        while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
        n.remove(); return;
      }
      walk(n);
    });
  })(d);
  return d.innerHTML;
}

function blogNbTools(ro){
  return ro ? '' : '<div class="blog-nbt"><span class="blog-add" title="插入區塊">＋</span><span class="blog-drag" title="拖曳搬移／點一下開選單">⠿</span></div>';
}
function blogBlockHtml(b, ro){
  var t = blogNbTools(ro);
  var ed = ro ? '' : ' contenteditable="true"';
  var j = function(o){ return bgEsc(JSON.stringify(o)); };
  switch (b.type){
    case 'heading':
      return '<div class="blog-nb" data-t="h' + (b.level || 2) + '">' + t
        + '<div class="blog-c blog-h' + (b.level || 2) + '"' + ed + ' data-ph="標題">'
        + (b.html ? blogSanitize(b.html) : bgEsc(b.text || '')) + '</div></div>';
    case 'list':
      return '<div class="blog-nb" data-t="' + (b.style === 'ol' ? 'ol' : 'ul') + '">' + t
        + '<div class="blog-c blog-' + (b.style === 'ol' ? 'ol' : 'ul') + '"' + ed + '>'
        + ((b.items || ['']).map(function(x){ return '<div>' + blogSanitize(x) + '</div>'; }).join('')) + '</div></div>';
    case 'quote':
      return '<div class="blog-nb" data-t="quote">' + t
        + '<div class="blog-c blog-quote"' + ed + ' data-ph="想強調的一句話">'
        + (b.html ? blogSanitize(b.html) : bgEsc(b.text || '')) + '</div></div>';
    case 'divider':
      return '<div class="blog-nb" data-t="hr">' + t + '<div class="blog-c"><div class="blog-hr"></div></div></div>';
    case 'image':
      var ar = (b.w && b.h) ? (b.w + ' × ' + b.h + '（' + blogRatioText(b.w, b.h) + '）· 不裁切') : '原圖比例 · 不裁切';
      return '<div class="blog-nb" data-t="img" data-j="' + j(b) + '">' + t + '<div class="blog-c">'
        + '<div class="blog-embw"><span class="blog-ratio">' + bgEsc(ar) + '</span>'
        + '<div class="blog-emb"' + (b.url ? ' style="background-image:url(\'' + bgEsc(b.url) + '\');aspect-ratio:' + ((b.w && b.h) ? b.w + '/' + b.h : '16/9') + '"' : ' style="aspect-ratio:16/9"') + ' onclick="blogLightbox(\'' + bgEsc(b.url || '') + '\',\'' + bgEsc(b.caption || '') + '\')"></div></div>'
        + (ro ? '' : '<div class="blog-embt"><button class="btn btn-secondary" onclick="blogNbPickImage(this)">' + (b.url ? '更換圖片' : '上傳圖片') + '</button></div>')
        + '<div class="blog-embm">'
        +   '<input class="blog-cap" placeholder="圖說（可留空）" value="' + bgEsc(b.caption || '') + '" oninput="blogNbMeta(this,\'caption\')"' + (ro ? ' disabled' : '') + '>'
        +   '<input class="blog-csrc" placeholder="來源（可留空）" value="' + bgEsc(b.source || '') + '" oninput="blogNbMeta(this,\'source\')"' + (ro ? ' disabled' : '') + '>'
        + '</div></div></div>';
    case 'video':
      return '<div class="blog-nb" data-t="vid" data-j="' + j(b) + '">' + t + '<div class="blog-c">'
        + '<div class="blog-embw"><span class="blog-ratio">' + bgEsc(b.platform ? b.platform + ' · 自動抓縮圖' : '貼上連結後自動抓縮圖') + '</span>'
        + '<div class="blog-emb blog-vid"' + (b.thumb ? ' style="background-image:url(\'' + bgEsc(b.thumb) + '\')"' : '') + ' onclick="blogLightbox(\'' + bgEsc(b.thumb || '') + '\',\'' + bgEsc(b.caption || '') + '\')">'
        + '<div class="blog-vp"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div></div></div>'
        + (ro ? '' : '<div class="blog-embt"><input class="blog-i" style="font-family:Inter,monospace;font-size:12px;max-width:360px" placeholder="貼上 YouTube / Vimeo 連結…" value="' + bgEsc(b.url || '') + '" oninput="blogNbVideoUrl(this)">'
            + '<button class="btn btn-secondary" onclick="blogNbPickThumb(this)">改用自己的封面</button></div>')
        + '<div class="blog-embm">'
        +   '<input class="blog-cap" placeholder="圖說（可留空）" value="' + bgEsc(b.caption || '') + '" oninput="blogNbMeta(this,\'caption\')"' + (ro ? ' disabled' : '') + '>'
        +   '<input class="blog-csrc" placeholder="來源（可留空）" value="' + bgEsc(b.source || '') + '" oninput="blogNbMeta(this,\'source\')"' + (ro ? ' disabled' : '') + '>'
        + '</div></div></div>';
    case 'carousel':
      return '<div class="blog-nb" data-t="car" data-j="' + j(b) + '">' + t + '<div class="blog-c">'
        + '<span class="blog-ratio" style="position:static;display:inline-block;background:#f0f9ff;color:#0369a1;border-color:#bae6fd">內文輪播 · '
        + ((b.items || []).length) + ' 張 · ' + bgEsc(b.ratio || '16:9') + '</span></div></div>';
    default:
      return '<div class="blog-nb" data-t="p">' + t
        + '<div class="blog-c"' + ed + ' data-ph="在這裡打字…　按 / 可插入標題、圖片、影片、引言">' + blogSanitize(b.html || '') + '</div></div>';
  }
}
function blogRatioText(w, h){
  var g = function(a, b){ return b ? g(b, a % b) : a; };
  var d = g(w, h) || 1;
  return (w / d) + ':' + (h / d);
}
function blogBlocksToHtml(blocks, ro){
  if (!blocks || !blocks.length) blocks = [{ type:'paragraph', html:'' }];
  return blocks.map(function(b){ return blogBlockHtml(b, ro); }).join('');
}

/* DOM → blocks
   keepEmpty=true 時連空白區塊也留著 —— 復原紀錄要忠實反映畫面，
   否則「按 ＋ 新增一個空段落」這一步會因為被濾掉而復原不了。
   存檔時一律用預設（false），空區塊不會寫進資料庫。 */
function blogReadDoc(keepEmpty){
  var doc = document.getElementById('blog-doc');
  if (!doc) return (BLOG_EDIT.content && BLOG_EDIT.content.blocks) || [];
  var out = [];
  Array.prototype.slice.call(doc.querySelectorAll(':scope > .blog-nb')).forEach(function(nb){
    var t = nb.getAttribute('data-t');
    var c = nb.querySelector('.blog-c');
    if (t === 'h2' || t === 'h3'){
      // text 一律保留純文字版本：SEO、目錄、搜尋、異動紀錄都吃這個欄位
      var txt = (c.textContent || '').trim();
      if (txt || keepEmpty) out.push({ type:'heading', level: t === 'h3' ? 3 : 2, text: txt, html: blogSanitize(c.innerHTML) });
    } else if (t === 'ul' || t === 'ol'){
      // 容忍還沒被整理好的結構：夾在 <div> 之間的裸文字也要算成一個項目，
      // 不能像以前那樣只讀 children —— 那會整行不見。
      var items = [], buf = '';
      var flush = function(){ if (String(buf).replace(/<[^>]*>/g,'').trim()) items.push(blogSanitize(buf)); buf = ''; };
      Array.prototype.slice.call(c.childNodes).forEach(function(n){
        if (n.nodeType === 1 && n.tagName.toLowerCase() === 'div'){ flush();
          var h = blogSanitize(n.innerHTML);
          if (String(h).replace(/<[^>]*>/g,'').trim()) items.push(h);
          return;
        }
        if (n.nodeType === 3) buf += bgEsc(n.nodeValue);
        else if (n.nodeType === 1) buf += n.outerHTML;
      });
      flush();
      if (items.length || keepEmpty) out.push({ type:'list', style:t, items: items.length ? items : [''] });
    } else if (t === 'quote'){
      var q = (c.textContent || '').trim();
      if (q || keepEmpty) out.push({ type:'quote', text:q, html: blogSanitize(c.innerHTML), source:'' });
    } else if (t === 'hr'){
      out.push({ type:'divider' });
    } else if (t === 'img' || t === 'vid' || t === 'car'){
      var j = {};
      try { j = JSON.parse(nb.getAttribute('data-j') || '{}'); } catch(e){}
      j.type = (t === 'img' ? 'image' : t === 'vid' ? 'video' : 'carousel');
      out.push(j);
    } else {
      var html = blogSanitize(c.innerHTML);
      if (String(html).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,'').trim() || keepEmpty) out.push({ type:'paragraph', html:html });
    }
  });
  return out;
}
function blogWordCount(){
  var el = document.getElementById('blog-wc');
  if (!el) return;
  var doc = document.getElementById('blog-doc');
  var n = doc ? (doc.textContent || '').replace(/\s/g, '').length : 0;
  el.textContent = '約 ' + n.toLocaleString() + ' 字';
}

/* 區塊操作 */
function blogNbOf(el){ return el.closest ? el.closest('.blog-nb') : null; }
function blogSetJ(nb, obj){ nb.setAttribute('data-j', JSON.stringify(obj)); blogTouch(); }
function blogGetJ(nb){ try { return JSON.parse(nb.getAttribute('data-j') || '{}'); } catch(e){ return {}; } }
function blogNbMeta(inp, k){
  var nb = blogNbOf(inp); if (!nb) return;
  var j = blogGetJ(nb); j[k] = inp.value; blogSetJ(nb, j);
}
function blogNbVideoUrl(inp){
  var nb = blogNbOf(inp); if (!nb) return;
  var j = blogGetJ(nb);
  j.url = inp.value;
  var info = blogParseVideo(inp.value);
  if (info){ j.platform = info.platform; j.videoId = info.id; if (!j.thumbManual && info.thumb) j.thumb = info.thumb; }
  blogSetJ(nb, j);
  var em = nb.querySelector('.blog-emb');
  if (em && j.thumb) em.style.backgroundImage = "url('" + j.thumb + "')";
  var rt = nb.querySelector('.blog-ratio');
  if (rt) rt.textContent = j.platform ? j.platform + ' · 自動抓縮圖' : '貼上連結後自動抓縮圖';
}
function blogNbPickImage(btn){
  var nb = blogNbOf(btn); if (!nb) return;
  blogPickFiles(false, async function(files){
    if (!files.length) return;
    bgToast('上傳中…');
    var r = await blogUpload(files[0]);
    if (!r) return;
    var j = blogGetJ(nb);
    j.url = r.url; j.w = r.w; j.h = r.h;
    blogSetJ(nb, j);
    var em = nb.querySelector('.blog-emb');
    if (em){ em.style.backgroundImage = "url('" + r.url + "')"; if (r.w && r.h) em.style.aspectRatio = r.w + '/' + r.h; }
    var rt = nb.querySelector('.blog-ratio');
    if (rt && r.w) rt.textContent = r.w + ' × ' + r.h + '（' + blogRatioText(r.w, r.h) + '）· 不裁切';
    btn.textContent = '更換圖片';
    bgToast('已插入圖片');
  });
}
function blogNbPickThumb(btn){
  var nb = blogNbOf(btn); if (!nb) return;
  blogPickFiles(false, async function(files){
    if (!files.length) return;
    var r = await blogUpload(files[0]);
    if (!r) return;
    var j = blogGetJ(nb);
    j.thumb = r.url; j.thumbManual = true;
    blogSetJ(nb, j);
    var em = nb.querySelector('.blog-emb');
    if (em) em.style.backgroundImage = "url('" + r.url + "')";
    bgToast('封面已更換');
  });
}

function blogMakeNb(type){
  var b;
  if (type === 'h2')         b = { type:'heading', level:2, text:'' };
  else if (type === 'h3')    b = { type:'heading', level:3, text:'' };
  else if (type === 'ul')    b = { type:'list', style:'ul', items:[''] };
  else if (type === 'ol')    b = { type:'list', style:'ol', items:[''] };
  else if (type === 'quote') b = { type:'quote', text:'' };
  else if (type === 'hr')    b = { type:'divider' };
  else if (type === 'img')   b = { type:'image', url:'', caption:'', source:'' };
  else if (type === 'vid')   b = { type:'video', url:'', thumb:'', caption:'', source:'' };
  else                       b = { type:'paragraph', html:'' };
  var wrap = document.createElement('div');
  wrap.innerHTML = blogBlockHtml(b, false);
  return wrap.firstChild;
}
/* 把游標放進區塊裡。清單一定要放進第一個 <div>（項目）裡面，
   放在容器上的話使用者打的第一行會變成沒有包 <div> 的裸文字 —— 那一行
   不會有項目符號，存檔時也會被整行吃掉。 */
function blogFocusBlock(el, atEnd){
  if (!el) return;
  var f = el.querySelector('[contenteditable]');
  if (!f) return;
  f.focus();
  var t = el.getAttribute('data-t');
  var target = f;
  if (t === 'ul' || t === 'ol'){
    target = atEnd ? f.lastElementChild : f.firstElementChild;
    if (!target){ target = document.createElement('div'); f.appendChild(target); }
  }
  var r = document.createRange();
  r.selectNodeContents(target);
  r.collapse(!atEnd);
  var s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
}

function blogInsertAfter(nb, type){
  var el = blogMakeNb(type);
  if (nb && nb.parentNode) nb.parentNode.insertBefore(el, nb.nextSibling);
  else document.getElementById('blog-doc').appendChild(el);
  blogTouchNow();
  blogFocusBlock(el, false);
  if (type === 'img'){ var b = el.querySelector('.blog-embt button'); if (b) b.click(); }
  blogWordCount();
  return el;
}

/* ── 清單結構的整理與換行 ──────────────────────────────────────────
   清單的每個項目都必須是 .blog-c 的直接 <div> 子節點。瀏覽器在
   contenteditable 裡自己處理 Enter、退格、貼上時常常會留下裸文字節點
   或空的 <div> —— 空 <div> 高度是 0，它的項目符號就會疊到下一行去。 */
function blogFixList(c){
  if (!c) return;
  var kids = Array.prototype.slice.call(c.childNodes);
  var buf = null;
  kids.forEach(function(n){
    if (n.nodeType === 1 && n.tagName.toLowerCase() === 'div'){ buf = null; return; }
    if (n.nodeType !== 1 && n.nodeType !== 3){ n.remove(); return; }
    if (n.nodeType === 3 && !n.nodeValue.length){ n.remove(); return; }
    if (!buf){ buf = document.createElement('div'); c.insertBefore(buf, n); }
    buf.appendChild(n);                 // 裸文字／行內標籤收進一個項目
  });
  if (!c.children.length) c.appendChild(document.createElement('div'));
}

/* 目前游標所在的那個項目 <div> */
function blogListItemOf(node, c){
  var n = node && node.nodeType === 3 ? node.parentNode : node;
  while (n && n !== c && n.parentNode !== c) n = n.parentNode;
  return (n && n.parentNode === c) ? n : null;
}

/* 清單裡按 Enter：自己處理，確保結構永遠是乾淨的 div 陣列。
   在空項目上按 Enter＝離開清單（跟一般編輯器一致）。 */
function blogListEnter(nb, c){
  var s = window.getSelection();
  if (!s.rangeCount) return;
  blogFixList(c);
  var r = s.getRangeAt(0);
  if (!r.collapsed) r.deleteContents();
  var item = blogListItemOf(r.startContainer, c) || c.lastElementChild;
  if (!item) return;

  if (!(item.textContent || '').trim()){          // 空項目 → 離開清單
    var only = c.children.length <= 1;
    item.remove();
    blogTouchNow();
    if (only) blogConvertNb(nb, 'p');
    else blogInsertAfter(nb, 'p');
    return;
  }

  var tail = document.createRange();
  tail.selectNodeContents(item);
  try { tail.setStart(r.startContainer, r.startOffset); } catch(e){ tail.collapse(false); }
  var ni = document.createElement('div');
  ni.appendChild(tail.extractContents());
  item.after(ni);
  var nr = document.createRange();
  nr.selectNodeContents(ni); nr.collapse(true);
  s.removeAllRanges(); s.addRange(nr);
  blogTouchNow();
  blogWordCount();
}
function blogFootAdd(type){
  var doc = document.getElementById('blog-doc');
  var last = doc && doc.lastElementChild;
  var el = blogInsertAfter(last, type);
  if (el && el.scrollIntoView) el.scrollIntoView({ block:'center' });
}

/* ── slash / 區段選單 ─────────────────────────────────────────────
   ⚠ 這兩個浮動選單一律掛在 document.body 上、用 position:fixed 定位。
      早期版本掛在編輯器裡並用 position:absolute，會依賴祖先元素有沒有
      position:relative —— 後台主檔的 .main 沒有，導致座標算錯、選單被推到
      畫面外，看起來就像「點了沒反應」。用 fixed + viewport 座標就沒有這個
      依賴，不管掛在哪、外層怎麼捲動都正確。                              */
var _blogSlashTarget = null, _blogBMenuTarget = null, _blogMenuBound = false, _blogSlashMode = 'insert';

function blogEnsureMenus(){
  var s = document.getElementById('blog-slash');
  if (!s){
    s = document.createElement('div');
    s.id = 'blog-slash'; s.className = 'blog-slash';
    document.body.appendChild(s);
  }
  s.innerHTML = '<div class="blog-sh">插入區塊</div>' + BLOG_SLASH_ITEMS.map(function(it){
    return '<div class="blog-si" data-ins="' + it[0] + '"><span class="blog-ic">' + it[1] + '</span><div><b>' + it[2] + '</b><em>' + it[3] + '</em></div></div>';
  }).join('');

  var m = document.getElementById('blog-bmenu');
  if (!m){
    m = document.createElement('div');
    m.id = 'blog-bmenu'; m.className = 'blog-bmenu';
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="blog-bcv" id="blog-bcv"><div class="blog-sh" style="padding:4px 10px 6px">轉換為</div><div class="blog-bcg">'
    +   BLOG_BLK_ITEMS.map(function(it){
          return '<button data-cv="' + it[0] + '" title="轉成' + it[2] + '">' + it[1] + '</button>';
        }).join('')
    + '</div><div class="blog-bsep"></div></div>'
    + '<div class="blog-bi" data-bm="up"><span>↑</span>上移一段</div>'
    + '<div class="blog-bi" data-bm="down"><span>↓</span>下移一段</div>'
    + '<div class="blog-bi" data-bm="dup"><span>⧉</span>複製這一段</div>'
    + '<div class="blog-bsep"></div>'
    + '<div class="blog-bi blog-dg" data-bm="del">刪除這一段</div>';

  if (_blogMenuBound) return;
  _blogMenuBound = true;

  // 點選單時不要讓內文失焦，游標位置才留得住（要用它來砍掉那個 "/"）
  s.addEventListener('mousedown', function(ev){ ev.preventDefault(); });

  s.addEventListener('click', function(ev){
    var it = ev.target.closest('.blog-si');
    if (!it || !_blogSlashTarget || !document.contains(_blogSlashTarget)) return;
    blogSlashApply(_blogSlashTarget, it.getAttribute('data-ins'), _blogSlashMode);
    blogHideSlash();
  });

  m.addEventListener('click', function(ev){
    var cv = ev.target.closest('[data-cv]');
    if (cv){
      if (_blogBMenuTarget && document.contains(_blogBMenuTarget)) blogConvertNb(_blogBMenuTarget, cv.getAttribute('data-cv'));
      blogHideBMenu();
      return;
    }
    var it = ev.target.closest('.blog-bi');
    if (!it || !_blogBMenuTarget || !document.contains(_blogBMenuTarget)) return;
    var nb = _blogBMenuTarget, a = it.getAttribute('data-bm'), doc = document.getElementById('blog-doc');
    if (!doc) return;
    if (a === 'del'){
      var only = doc.querySelectorAll('.blog-nb').length <= 1;
      nb.remove();
      if (only) doc.appendChild(blogMakeNb('p'));
    } else if (a === 'up'){ var pv = nb.previousElementSibling; if (pv) pv.before(nb); }
    else if (a === 'down'){ var nx = nb.nextElementSibling; if (nx) nx.after(nb); }
    else if (a === 'dup'){ nb.after(nb.cloneNode(true)); }
    blogTouchNow();
    blogHideBMenu();
    blogWordCount();
  });

  // 點空白處關閉；捲動時也關閉（fixed 選單不會跟著內容跑）
  document.addEventListener('click', function(e){
    if (!e.target.closest('.blog-slash') && !e.target.closest('.blog-add')) blogHideSlash();
    if (!e.target.closest('.blog-bmenu') && !e.target.closest('.blog-drag')) blogHideBMenu();
  });
  var sc = document.querySelector('.main');
  if (sc) sc.addEventListener('scroll', function(){ blogHideSlash(); blogHideBMenu(); }, { passive:true });
  window.addEventListener('resize', function(){ blogHideSlash(); blogHideBMenu(); });
}

/* 以視窗座標定位，並確保不超出畫面 */
function blogFloatAt(el, anchor, align){
  if (!el || !anchor) return;
  el.classList.add('blog-on');              // 先顯示才量得到尺寸
  el.style.left = '-9999px'; el.style.top = '-9999px';
  var r = anchor.getBoundingClientRect();
  var w = el.offsetWidth || 262, h = el.offsetHeight || 300;
  var pad = 8;
  var left = (align === 'right') ? (r.right - w) : (r.left + 8);   // 靠右對齊：選單右緣切齊按鈕右緣
  if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
  if (left < pad) left = pad;
  var top = r.bottom + 6;
  if (top + h > window.innerHeight - pad){
    var above = r.top - h - 6;                // 下方放不下就翻到上方
    top = (above >= pad) ? above : Math.max(pad, window.innerHeight - h - pad);
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top  = Math.round(top) + 'px';
}
/* 打 "/" 叫出來的選單＝把「這一段」變成那個型別；
   點 ＋ 叫出來的＝在下面「插入新的一段」。同一個選單，兩種意思，標題也跟著換。 */
function blogShowSlash(nb, anchor, mode){
  blogEnsureMenus();
  _blogSlashTarget = nb;
  _blogSlashMode = mode || 'insert';
  var s = document.getElementById('blog-slash');
  var h = s && s.querySelector('.blog-sh');
  if (h) h.textContent = (_blogSlashMode === 'convert') ? '把這一段改成' : '在下面插入區塊';
  blogHideBMenu();
  blogFloatAt(s, anchor || nb);
}

/* 砍掉觸發選單的那個 "/"（游標前一個字元；找不到就砍整段結尾的） */
function blogStripSlash(nb){
  var c = nb.querySelector('.blog-c[contenteditable="true"]');
  if (!c) return;
  var s = window.getSelection();
  if (s && s.rangeCount){
    var r = s.getRangeAt(0), n = r.startContainer;
    if (n.nodeType === 3 && c.contains(n) && r.startOffset > 0 && n.nodeValue.charAt(r.startOffset - 1) === '/'){
      var off = r.startOffset;
      n.nodeValue = n.nodeValue.slice(0, off - 1) + n.nodeValue.slice(off);
      try { var nr = document.createRange(); nr.setStart(n, off - 1); nr.collapse(true);
            s.removeAllRanges(); s.addRange(nr); } catch(e){}
      return;
    }
  }
  if ((c.textContent || '').slice(-1) !== '/') return;
  var w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, null), last = null, t;
  while ((t = w.nextNode())) if (t.nodeValue.length) last = t;
  if (last && last.nodeValue.slice(-1) === '/') last.nodeValue = last.nodeValue.slice(0, -1);
}

var BLOG_TEXT_TYPES = ['p','h2','h3','ul','ol','quote'];

function blogSlashApply(nb, type, mode){
  if (mode !== 'convert'){ blogInsertAfter(nb, type); return; }

  var cur = nb.getAttribute('data-t');
  if (['img','vid','car','hr'].indexOf(cur) >= 0){ blogInsertAfter(nb, type); return; }

  blogStripSlash(nb);
  var c = nb.querySelector('.blog-c[contenteditable="true"]');
  var empty = !c || !(c.textContent || '').trim();

  if (BLOG_TEXT_TYPES.indexOf(type) >= 0){
    if (cur === type){ blogFocusBlock(nb, true); blogTouchNow(); return; }
    var el = blogConvertNb(nb, type);
    if (!el) blogInsertAfter(nb, type);
    return;
  }

  // 圖片／影片／分隔線沒有文字。這一段是空的就直接取代，還有字就插在下面。
  if (!empty){ blogInsertAfter(nb, type); return; }
  var neu = blogMakeNb(type);
  nb.replaceWith(neu);
  blogTouchNow();
  var f = neu.querySelector('[contenteditable]');
  if (f) f.focus();
  if (type === 'img'){ var bt = neu.querySelector('.blog-embt button'); if (bt) bt.click(); }
  blogWordCount();
}
function blogHideSlash(){ var s = document.getElementById('blog-slash'); if (s) s.classList.remove('blog-on'); }
function blogShowBMenu(nb, anchor){
  blogEnsureMenus();
  _blogBMenuTarget = nb;
  blogHideSlash();
  // 圖片／影片／分隔線沒有文字，不顯示「轉換為」
  var cv = document.getElementById('blog-bcv');
  var t = nb ? nb.getAttribute('data-t') : '';
  if (cv) cv.style.display = (['img','vid','car','hr'].indexOf(t) >= 0) ? 'none' : '';
  blogFloatAt(document.getElementById('blog-bmenu'), anchor || nb);
}
function blogHideBMenu(){ var m = document.getElementById('blog-bmenu'); if (m) m.classList.remove('blog-on'); }

function blogBindDoc(){
  var doc = document.getElementById('blog-doc');
  if (!doc) return;
  // 同一個節點只綁一次。重複綁的話一次 Enter 會被處理兩遍（第二遍作用在
  // 剛產生的空項目上，看起來就像「按 Enter 直接跳出清單」）。
  if (doc.getAttribute('data-bound') === '1'){ blogEnsureFmt(); blogSummaryCount(); blogWordCount(); blogSlugHint(); return; }
  doc.setAttribute('data-bound', '1');
  doc.addEventListener('click', function(e){
    var a = e.target.closest('.blog-add');
    if (a){ e.stopPropagation(); blogShowSlash(a.closest('.blog-nb'), a, 'insert'); return; }
    var d = e.target.closest('.blog-drag');
    if (d){ e.stopPropagation(); blogShowBMenu(d.closest('.blog-nb'), d); return; }
  });
  doc.addEventListener('keyup', function(e){
    if (e.key === '/'){ var nb = e.target.closest('.blog-nb'); if (nb) blogShowSlash(nb, nb, 'convert'); }
    else if (['ArrowDown','ArrowUp','Enter','Shift','Control','Meta','Alt'].indexOf(e.key) < 0) blogHideSlash();
  });
  doc.addEventListener('keydown', function(e){
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); blogFmtLink(); return; }
    if (e.key === 'Enter' && !e.shiftKey){
      if (blogImeBusy(e)) return;       // 選字用的 Enter，不要拿來斷段落
      var nb = e.target.closest('.blog-nb');
      if (!nb) return;
      e.preventDefault();
      if (['ul','ol'].indexOf(nb.getAttribute('data-t')) >= 0) blogListEnter(nb, nb.querySelector('.blog-c'));
      else blogInsertAfter(nb, 'p');
    }
  });
  doc.addEventListener('input', function(e){
    // 貼上、退格合併也可能把清單弄成裸文字，發現變形就就地整理好（游標留在原處）
    var nb = e.target && e.target.closest ? e.target.closest('.blog-nb') : null;
    if (nb && ['ul','ol'].indexOf(nb.getAttribute('data-t')) >= 0){
      var c = nb.querySelector('.blog-c');
      var bad = c && Array.prototype.slice.call(c.childNodes).some(function(n){
        return !(n.nodeType === 1 && n.tagName.toLowerCase() === 'div');
      });
      if (bad){ var m = blogCaretMark(); blogFixList(c); blogCaretRestore(m); }
    }
    _blogTypedAt = Date.now();
    blogTouch(); blogWordCount();
  });
  doc.addEventListener('mouseup', function(){ setTimeout(blogFmtUpdate, 0); });
  doc.addEventListener('paste', function(e){
    e.preventDefault();
    var txt = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, txt);
  });
  var dz = document.getElementById('blog-dz');
  if (dz){
    ['dragenter','dragover'].forEach(function(ev){ dz.addEventListener(ev, function(x){ x.preventDefault(); dz.classList.add('blog-hot'); }); });
    ['dragleave','drop'].forEach(function(ev){ dz.addEventListener(ev, function(x){ x.preventDefault(); dz.classList.remove('blog-hot'); }); });
    dz.addEventListener('drop', function(x){
      var fs = Array.prototype.slice.call((x.dataTransfer && x.dataTransfer.files) || []);
      if (fs.length) blogAddFilesToGallery(fs);
    });
  }
  blogEnsureFmt();
  blogSummaryCount();
  blogWordCount();
  blogSlugHint();
}

/* ── 選取文字後浮出的格式工具列 ───────────────────────────────────
   在內文裡選一段字就會浮出來：可以把這一段轉成標題／引言／清單，
   也可以對選取範圍套粗體、斜體、底線、刪除線、顏色、螢光筆、連結。
   同樣掛在 document.body 上並用 position:fixed，理由見上面的說明。   */

var BLOG_FORE_SW = ['#111827','#dc2626','#ea580c','#d97706','#16a34a','#0891b2','#2563eb','#7c3aed','#db2777','#6b7280'];
var BLOG_BACK_SW = ['#fef08a','#fed7aa','#fecaca','#bbf7d0','#bfdbfe','#e9d5ff','#fbcfe8','#e5e7eb'];
/* 第一顆刻意用「內文」兩個字而不是 ¶ 符號 —— 把標題改回內文是最常用的一步，
   使用者不該需要先猜出 ¶ 是什麼意思。 */
var BLOG_BLK_ITEMS = [['p','內文','內文段落'],['h2','H2','大標題'],['h3','H3','小標題'],['ul','•','項目清單'],['ol','1.','編號清單'],['quote','❝','引言']];

var _blogFmtBound = false, _blogPalKind = 'fore', _blogRange = null;

/* 選取範圍所在的可編輯區塊；不在內文裡就回 null */
function blogFmtHost(){
  var s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  var n = s.getRangeAt(0).commonAncestorContainer;
  if (n.nodeType === 3) n = n.parentNode;
  if (!n || !n.closest) return null;
  var c = n.closest('.blog-c[contenteditable="true"]');
  return (c && c.closest('#blog-doc')) ? c : null;
}
function blogSaveRange(){
  var s = window.getSelection();
  if (s && s.rangeCount) _blogRange = s.getRangeAt(0).cloneRange();
}
function blogUseRange(){
  if (!_blogRange) return false;
  var host = _blogRange.commonAncestorContainer;
  if (host.nodeType === 3) host = host.parentNode;
  if (!host || !document.contains(host)) return false;
  var c = host.closest && host.closest('.blog-c[contenteditable="true"]');
  if (c) c.focus();
  var s = window.getSelection();
  s.removeAllRanges(); s.addRange(_blogRange);
  return true;
}

function blogEnsureFmt(){
  var f = document.getElementById('blog-fmt');
  if (!f){
    f = document.createElement('div');
    f.id = 'blog-fmt'; f.className = 'blog-fmt';
    document.body.appendChild(f);
  }
  if (!f.innerHTML){
    var SVG_LINK = '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 11.5a3.2 3.2 0 004.6 0l2.6-2.6a3.2 3.2 0 10-4.6-4.6l-1.2 1.2"/><path d="M11.5 8.5a3.2 3.2 0 00-4.6 0l-2.6 2.6a3.2 3.2 0 104.6 4.6l1.2-1.2"/></svg>';
    f.innerHTML =
      '<div class="blog-fg">'
      + BLOG_BLK_ITEMS.map(function(it){
          return '<button data-blk="' + it[0] + '" title="轉成' + it[2] + '">' + it[1] + '</button>';
        }).join('')
      + '</div><div class="blog-fx"></div>'
      + '<div class="blog-fg">'
      +   '<button data-cmd="bold" title="粗體（⌘B）"><b>B</b></button>'
      +   '<button data-cmd="italic" title="斜體（⌘I）"><i>I</i></button>'
      +   '<button data-cmd="underline" title="底線（⌘U）"><u>U</u></button>'
      +   '<button data-cmd="strikeThrough" title="刪除線"><s>S</s></button>'
      +   '<button data-act="code" title="行內強調底色"><code>&lt;&gt;</code></button>'
      + '</div><div class="blog-fx"></div>'
      + '<div class="blog-fg">'
      +   '<button data-pal="fore" title="文字顏色"><span class="blog-fa">A</span><i id="blog-fbar-fore" style="background:#dc2626"></i></button>'
      +   '<button data-pal="back" title="螢光筆底色"><span class="blog-fa blog-fam">▮</span><i id="blog-fbar-back" style="background:#fef08a"></i></button>'
      +   '<button data-act="link" title="插入連結（⌘K）">' + SVG_LINK + '</button>'
      +   '<button data-act="clear" title="清除所有格式">✕</button>'
      + '</div>';
  }

  var p = document.getElementById('blog-pal');
  if (!p){
    p = document.createElement('div');
    p.id = 'blog-pal'; p.className = 'blog-pal';
    document.body.appendChild(p);
  }

  if (_blogFmtBound) return f;
  _blogFmtBound = true;

  // 按下去不要讓內文失焦，選取範圍才不會消失
  f.addEventListener('mousedown', function(e){ e.preventDefault(); });
  p.addEventListener('mousedown', function(e){
    if (e.target.id !== 'blog-pal-in') e.preventDefault();
  });

  f.addEventListener('click', function(e){
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.blk){ blogConvertNb(blogFmtNb(), b.dataset.blk); blogHideFmt(); return; }
    if (b.dataset.cmd){ blogExec(b.dataset.cmd); return; }
    if (b.dataset.pal){ blogShowPal(b.dataset.pal, b); return; }
    var a = b.dataset.act;
    if (a === 'code')  blogFmtCode();
    if (a === 'link')  blogFmtLink();
    if (a === 'clear') blogFmtClear();
  });

  p.addEventListener('click', function(e){
    var sw = e.target.closest('[data-c]');
    if (sw){ blogApplyColor(_blogPalKind, sw.getAttribute('data-c')); return; }
    if (e.target.closest('[data-pclear]')){ blogClearColor(_blogPalKind); blogHidePal(); }
  });

  document.addEventListener('click', function(e){
    if (!e.target.closest('#blog-fmt') && !e.target.closest('#blog-pal')) blogHidePal();
  });
  document.addEventListener('selectionchange', blogFmtUpdate);
  // 捲動時「跟著選取範圍移動」而不是關掉 —— 選好字再捲一下就要重選很煩。
  // 選取範圍真的捲出畫面時，blogFmtUpdate 內部才會收起來。
  var sc = document.querySelector('.main');
  if (sc) sc.addEventListener('scroll', function(){ blogHidePal(); blogFmtUpdate(); }, { passive:true });
  window.addEventListener('resize', function(){ blogHidePal(); blogFmtUpdate(); });
  return f;
}

/* 選取範圍所在的區塊（.blog-nb） */
function blogFmtNb(){
  var c = blogFmtHost();
  return c ? c.closest('.blog-nb') : null;
}

function blogHideFmt(){
  var f = document.getElementById('blog-fmt'); if (f) f.classList.remove('blog-on');
  blogHidePal();
}
function blogHidePal(){
  var p = document.getElementById('blog-pal'); if (p) p.classList.remove('blog-on');
}

/* 依選取範圍的位置浮出（優先放上方，上面不夠就放下方） */
function blogFloatRect(el, rect){
  el.classList.add('blog-on');
  el.style.left = '-9999px'; el.style.top = '-9999px';
  var w = el.offsetWidth, h = el.offsetHeight, pad = 8;
  var left = rect.left + rect.width / 2 - w / 2;
  if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
  if (left < pad) left = pad;
  var top = rect.top - h - 8;
  if (top < pad){
    top = rect.bottom + 8;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
  }
  el.style.left = Math.round(left) + 'px';
  el.style.top  = Math.round(top) + 'px';
}

var _blogTypedAt = 0;

function blogFmtUpdate(){
  var f = document.getElementById('blog-fmt');
  if (!f) return;
  var s = window.getSelection();
  var host = blogFmtHost();
  var pal = document.getElementById('blog-pal');
  var keep = function(){ if (!pal || !pal.classList.contains('blog-on')) blogHideFmt(); };
  if (!host || !s || !s.rangeCount){ keep(); return; }

  var nb = host.closest('.blog-nb');
  var t = nb ? nb.getAttribute('data-t') : 'p';
  var sel = !s.isCollapsed && !!String(s).trim();

  /* 沒有選字時：只要游標停在「不是一般內文」的區塊裡（標題／引言／清單），
     就浮出轉換那一排 —— 否則使用者把段落改成 H2 之後，會找不到改回去的地方。
     打字當下不跳出來，免得一直在眼前晃；下次點一下或用方向鍵移動就會出現。 */
  if (!sel){
    if (t === 'p' || !t || (Date.now() - _blogTypedAt) < 400){ keep(); return; }
  }
  f.classList.toggle('blog-blkonly', !sel);
  blogSaveRange();

  f.querySelectorAll('[data-blk]').forEach(function(b){
    b.classList.toggle('blog-on', b.dataset.blk === t);
  });
  ['bold','italic','underline','strikeThrough'].forEach(function(c){
    var b = f.querySelector('[data-cmd="' + c + '"]');
    if (b){ try { b.classList.toggle('blog-on', document.queryCommandState(c)); } catch(e){} }
  });
  var cd = f.querySelector('[data-act="code"]');
  var an = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode);
  if (cd) cd.classList.toggle('blog-on', !!(an && an.closest && an.closest('code')));

  var r = s.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height) r = host.getBoundingClientRect();   // 游標沒有寬度時改抓整個區塊
  if (!r.width && !r.height) return;
  // 選取範圍整個捲出畫面時就別浮出來，免得工具列黏在無關的地方
  if (r.bottom < 0 || r.top > window.innerHeight){ blogHideFmt(); return; }
  blogFloatRect(f, r);
}

/* 粗體／斜體／底線／刪除線：不動 DOM 結構，所以選取範圍留著，
   工具列也留著 —— 可以連續套好幾個格式。存檔時 blogReadDoc 會統一過濾。 */
function blogExec(cmd, val){
  if (!blogFmtHost() && !blogUseRange()) return;
  if (!blogFmtHost()) return;
  // 這幾個要 styleWithCSS=false，瀏覽器才會產生 <b>/<i>/<u> 而不是 CSS 樣式
  try { document.execCommand('styleWithCSS', false, false); } catch(e){}
  document.execCommand(cmd, false, val === undefined ? null : val);
  blogTouchNow();
  blogSaveRange();
  blogFmtUpdate();
}

function blogShowPal(kind, btn){
  blogEnsureFmt();
  blogSaveRange();
  _blogPalKind = kind;
  var p = document.getElementById('blog-pal');
  var sw = (kind === 'fore') ? BLOG_FORE_SW : BLOG_BACK_SW;
  p.innerHTML = '<div class="blog-ph">' + (kind === 'fore' ? '文字顏色' : '螢光筆底色') + '</div>'
    + '<div class="blog-pg">' + sw.map(function(c){
        return '<span class="blog-sw" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></span>';
      }).join('') + '</div>'
    + '<label class="blog-pf">自由選色<input type="color" id="blog-pal-in" value="' + (kind === 'fore' ? '#dc2626' : '#fef08a') + '"></label>'
    + '<button class="blog-pc" data-pclear>移除' + (kind === 'fore' ? '文字顏色' : '底色') + '</button>';

  var inp = document.getElementById('blog-pal-in');
  inp.addEventListener('input', function(){ blogApplyColor(kind, this.value, true); });
  inp.addEventListener('change', function(){ blogApplyColor(kind, this.value); });

  p.classList.add('blog-on');
  p.style.left = '-9999px'; p.style.top = '-9999px';
  var r = btn.getBoundingClientRect(), pad = 8;
  var left = Math.min(r.left, window.innerWidth - p.offsetWidth - pad);
  var top  = r.bottom + 6;
  if (top + p.offsetHeight > window.innerHeight - pad) top = Math.max(pad, r.top - p.offsetHeight - 6);
  p.style.left = Math.round(Math.max(pad, left)) + 'px';
  p.style.top  = Math.round(top) + 'px';
}

function blogApplyColor(kind, color, keepOpen){
  if (!blogUseRange()) return;
  var host = blogFmtHost();
  if (!host) return;
  try { document.execCommand('styleWithCSS', false, true); } catch(e){}
  document.execCommand(kind === 'fore' ? 'foreColor' : 'hiliteColor', false, color)
    || document.execCommand(kind === 'fore' ? 'foreColor' : 'backColor', false, color);
  // 自由選色拖曳時 input 事件會連發，用延遲合併，整段拖曳只算一步
  if (keepOpen) blogTouch(); else blogTouchNow();
  blogSaveRange();
  var bar = document.getElementById('blog-fbar-' + kind);
  if (bar) bar.style.background = color;    // 按鈕下面那條色塊記住上次用的顏色
  if (!keepOpen) blogHidePal();
}

/* 移除顏色：先塗上一個不可能有人用的哨兵色，再把帶那個顏色的 span 拆掉 */
function blogClearColor(kind){
  if (!blogUseRange()) return;
  var host = blogFmtHost();
  if (!host) return;
  var hex = (kind === 'fore') ? '#010203' : '#030201';
  var rgb = (kind === 'fore') ? 'rgb(1, 2, 3)' : 'rgb(3, 2, 1)';
  try { document.execCommand('styleWithCSS', false, true); } catch(e){}
  document.execCommand(kind === 'fore' ? 'foreColor' : 'hiliteColor', false, hex)
    || document.execCommand(kind === 'fore' ? 'foreColor' : 'backColor', false, hex);
  Array.prototype.slice.call(host.querySelectorAll('span')).forEach(function(sp){
    var v = (kind === 'fore') ? sp.style.color : sp.style.backgroundColor;
    if (v !== rgb) return;
    if (kind === 'fore') sp.style.color = ''; else sp.style.backgroundColor = '';
    if (!sp.getAttribute('style')){
      while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp);
      sp.remove();
    }
  });
  host.innerHTML = blogSanitize(host.innerHTML);
  blogTouchNow();
  blogHideFmt();
}

/* 行內強調底色 <code>：已經在 code 裡就拆掉，否則包起來 */
function blogFmtCode(){
  if (!blogUseRange()) return;
  var host = blogFmtHost();
  if (!host) return;
  var s = window.getSelection();
  var an = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode);
  var inCode = an && an.closest && an.closest('code');
  if (inCode && host.contains(inCode)){
    while (inCode.firstChild) inCode.parentNode.insertBefore(inCode.firstChild, inCode);
    inCode.remove();
  } else {
    var r = s.getRangeAt(0);
    var c = document.createElement('code');
    try { r.surroundContents(c); }
    catch(e){ c.appendChild(r.extractContents()); r.insertNode(c); }   // 跨標籤選取時的退路
  }
  host.innerHTML = blogSanitize(host.innerHTML);
  blogTouchNow();
  blogHideFmt();
}

function blogFmtLink(){
  blogSaveRange();
  var s = window.getSelection();
  var an = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentNode : s.anchorNode);
  var cur = an && an.closest ? an.closest('a') : null;
  var url = prompt('要連到哪裡？（留空＝移除連結）', cur ? cur.getAttribute('href') || '' : 'https://');
  if (url === null) return;
  url = url.trim();
  if (!blogUseRange()) return;
  var host = blogFmtHost();
  if (!host) return;
  if (!url){ document.execCommand('unlink'); }
  else {
    if (!/^https?:\/\//i.test(url)){
      bgToast('網址要以 http:// 或 https:// 開頭。', 'err');
      return;
    }
    document.execCommand('createLink', false, url);
  }
  host.innerHTML = blogSanitize(host.innerHTML);
  blogTouchNow();
  blogHideFmt();
}

function blogFmtClear(){
  if (!blogUseRange()) return;
  var host = blogFmtHost();
  if (!host) return;
  try { document.execCommand('styleWithCSS', false, true); } catch(e){}
  document.execCommand('removeFormat');
  document.execCommand('unlink');
  // removeFormat 不處理 <code>，手動拆掉選取範圍內的
  var r = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
  Array.prototype.slice.call(host.querySelectorAll('code')).forEach(function(c){
    if (r && !r.intersectsNode(c)) return;
    while (c.firstChild) c.parentNode.insertBefore(c.firstChild, c);
    c.remove();
  });
  host.innerHTML = blogSanitize(host.innerHTML);
  blogTouchNow();
  blogHideFmt();
}

/* 轉換區塊型別，內容照搬過去 */
function blogConvertNb(nb, type){
  if (!nb) return null;
  var cur = nb.getAttribute('data-t');
  if (cur === type) return nb;
  if (['img','vid','car','hr'].indexOf(cur) >= 0){
    bgToast('圖片、影片與分隔線沒有文字可以轉換。', 'err');
    return null;
  }
  var c = nb.querySelector('.blog-c');
  var html, text = (c.textContent || '').trim();
  if (cur === 'ul' || cur === 'ol'){
    var parts = Array.prototype.slice.call(c.children).map(function(d){ return blogSanitize(d.innerHTML); });
    html = (parts.length ? parts : [blogSanitize(c.innerHTML)]).join('<br>');
  } else {
    html = blogSanitize(c.innerHTML);
  }

  var b;
  if (type === 'h2' || type === 'h3')  b = { type:'heading', level: type === 'h3' ? 3 : 2, text:text, html:html };
  else if (type === 'quote')           b = { type:'quote', text:text, html:html, source:'' };
  else if (type === 'ul' || type === 'ol'){
    var items = html.split(/<br\s*\/?>/i).map(function(x){ return blogSanitize(x); })
      .filter(function(x){ return String(x).replace(/<[^>]*>/g, '').trim(); });
    b = { type:'list', style:type, items: items.length ? items : [''] };
  }
  else b = { type:'paragraph', html:html };

  var wrap = document.createElement('div');
  wrap.innerHTML = blogBlockHtml(b, false);
  var el = wrap.firstChild;
  nb.replaceWith(el);
  blogTouchNow();

  blogFocusBlock(el, true);
  blogWordCount();
  return el;
}

/* ── 儲存 / 發佈 ─────────────────────────────────────────────────── */
function blogCollect(){
  var e = BLOG_EDIT;
  e.content = { v:1, blocks: blogReadDoc() };
  return {
    slug: e.slug, title: e.title || '', summary: e.summary || '',
    cover_url: e.cover_url || null, cover_source: e.cover_source || null,
    category: e.category || null, tags: e.tags || [],
    gallery: e.gallery || [], gallery_ratio: e.gallery_ratio || '16:9',
    content: e.content, is_pinned: !!e.is_pinned,
    updated_by: bgMe()
  };
}
async function blogSaveDraft(silent){
  var e = BLOG_EDIT;
  if (!e) return false;
  if (!e.slug){
    e.slug = await blogUniqueSlug(blogDateSlug());
    var inp = document.getElementById('blog-f-slug'); if (inp) inp.value = e.slug;
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug)){
    bgToast('網址代稱只能用小寫英文、數字與連字號。按「自動產生」可以幫你產一個。', 'err');
    return false;
  }
  var pid = await blogEnsurePost();
  if (!pid) return false;

  var r = await sb.from('blog_posts').update(blogCollect()).eq('id', pid);
  if (r.error){
    bgToast('儲存失敗：' + r.error.message, 'err');
    return false;
  }
  try { await sb.rpc('blog_log_revision', { p_post_id:pid, p_action:'edit', p_note:null, p_operator:bgMe() }); } catch(err){}

  BLOG_DIRTY = false;
  var msg = document.getElementById('blog-savemsg');
  if (msg) msg.innerHTML = '<i></i>已儲存 · ' + bgDt(new Date().toISOString());
  if (!silent) bgToast('已儲存草稿');

  var fresh = await sb.from('blog_posts').select('*').eq('id', pid).single();
  if (fresh && fresh.data){
    BLOG_EDIT.updated_time = fresh.data.updated_time;
    BLOG_EDIT.updated_by   = fresh.data.updated_by;
    var i = BLOG_DB.map(function(p){ return p.id; }).indexOf(pid);
    if (i >= 0) BLOG_DB[i] = fresh.data; else BLOG_DB.unshift(fresh.data);
  }
  return true;
}
async function blogPublishFromEditor(){
  if (!(await blogSaveDraft(true))) return;
  var e = BLOG_EDIT;
  var check = JSON.parse(JSON.stringify(e));
  var miss = blogValidate(check);
  if (miss.length){ bgToast('還不能發佈，缺少：' + miss.join('、'), 'err'); return; }
  if (!confirm('確定要發佈這篇文章嗎？\n\n發佈後官網會立刻看得到，而且文章會變成唯讀 —— 要再修改必須先下架。')) return;
  var first = !e.published_at;
  if (await blogSetStatus(e.id, 'published', first ? 'publish' : 'republish')){
    bgToast(first ? '已發佈' : '已重新發佈');
    blogTriggerBuild();
    BLOG_EDIT = null;
  }
}

/* 自動暫存到 localStorage（避免關掉分頁前功盡棄） */
setInterval(function(){
  if (!BLOG_EDIT || !BLOG_DIRTY) return;
  try {
    var snap = JSON.parse(JSON.stringify(BLOG_EDIT));
    snap.content = { v:1, blocks: blogReadDoc() };
    localStorage.setItem('gc_blog_autosave', JSON.stringify({ t:Date.now(), d:snap }));
  } catch(e){}
}, 30000);

window.addEventListener('beforeunload', function(e){
  if (BLOG_DIRTY){ e.preventDefault(); e.returnValue = ''; return ''; }
});
