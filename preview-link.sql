-- ═══════════════════════════════════════════════════════════════════
-- GC 洞察文章 — 未發佈文章的預覽連結
-- 在 Supabase → SQL Editor 貼上整段執行一次即可（可重複執行）。
--
-- 目的：文章寫完但還不能正式發佈時，也能給一個對外連結請人幫忙看。
-- 規則：
--   · 拿到連結的人看得到完整文章，不用登入
--   · 沒有 token 就跟以前一樣「找不到文章」
--   · 只有「草稿」與「已下架」能被預覽；已發佈的走一般網址
--   · 不會出現在列表頁與 sitemap，頁面也會帶 noindex 不給 Google 收錄
--   · 後台按「發佈」時會把 token 清掉 —— 舊的預覽連結自動失效
-- ═══════════════════════════════════════════════════════════════════

-- 1) 每篇文章一組隨機 token（沒發過就是 NULL）
alter table public.blog_posts
  add column if not exists preview_token uuid;

create unique index if not exists blog_posts_preview_token_key
  on public.blog_posts (preview_token)
  where preview_token is not null;

-- 2) 匿名可以「憑 token」讀一篇還沒發佈的文章
--    security definer：函式以擁有者權限執行，所以不必為 blog_posts 開任何
--    匿名 RLS 政策；沒有正確的 token 就回 NULL，撈不到任何東西。
--    回傳時刻意拿掉操作者欄位與 token 本身，避免連結被轉傳後又被拿去猜別篇。
create or replace function public.blog_preview(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (to_jsonb(p) - 'created_by' - 'updated_by' - 'published_by'
                      - 'preview_token' - 'id')
         || jsonb_build_object(
              -- category_name(s) 不是實體欄位，是 public_blog_posts view 即時
              -- join 出來的，所以這裡照樣 join 一次，預覽頁的分類籤才會顯示
              -- 中文名稱而不是英文代稱。
              -- to_jsonb() 包一層是為了讓 categories 不論存成 text[] 或 jsonb
              -- 都能展開。
              'category_names',
              coalesce((
                select jsonb_agg(c.name order by u.ord)
                from jsonb_array_elements_text(to_jsonb(p.categories))
                     with ordinality as u(slug, ord)
                join public.blog_categories c on c.slug = u.slug
              ), '[]'::jsonb),
              'category_name',
              (select c.name from public.blog_categories c where c.slug = p.category)
            )
  from public.blog_posts p
  where p_token is not null
    and p.preview_token = p_token
    and p.status in ('draft', 'unpublished')
  limit 1;
$$;

revoke all on function public.blog_preview(uuid) from public;
grant execute on function public.blog_preview(uuid) to anon, authenticated;
