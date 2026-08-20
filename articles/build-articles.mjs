#!/usr/bin/env node
/**
 * build-articles.mjs
 *
 * content/articles.json を読み込み、記事ごとに静的HTML（articles/{slug}.html）を生成する。
 * ハッシュルーティング（index.html#/pick/xxx）だと、クローラーやASP審査から見て
 * 「別ページ」として認識されにくいため、記事本文が最初から入った実ファイルを出力する方式に切り替えた。
 *
 * 使い方:
 *   node scripts/build-articles.mjs
 *
 * 実行すると、リポジトリ直下に以下が生成される（既存ファイルは上書き）:
 *   /articles/{slug}.html   ... 記事本体
 *   /articles/index.html    ... 記事一覧
 *
 * 新しい記事を追加するには content/articles.json に項目を追加して、このスクリプトを
 * 再実行するだけでよい（GitHub Actionsで自動実行する設定は .github/workflows/build-articles.yml を参照）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTICLES_JSON = join(ROOT, "content", "articles.json");
const OUT_DIR = join(ROOT, "articles");
const THUMBS_DIR = join(ROOT, "assets", "thumbnails");
const THUMB_EXTS = ["png", "jpg", "jpeg", "webp"];

/**
 * assets/thumbnails/{slug}.{png|jpg|jpeg|webp} が存在すれば、そのパスを返す。
 * articles.json に明示的な thumbnail フィールドがあればそちらを優先する
 * （外部URLを使いたい場合はそちらで上書きできる）。
 */
function resolveThumbnail(slug, explicitThumbnail){
  if(explicitThumbnail) return explicitThumbnail;
  for(const ext of THUMB_EXTS){
    if(existsSync(join(THUMBS_DIR, `${slug}.${ext}`))){
      return `../assets/thumbnails/${slug}.${ext}`;
    }
  }
  return null;
}

const SITE_NAME = "ペイ択（Paytaku）";
const SITE_URL = "https://paytaku.github.io";

/* カテゴリ別のサムネイル・フォールバック（thumbnailフィールドが無い記事に使う） */
const THUMB_GRADIENT = {
  "カード解説": "linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)",
  "キャンペーン": "linear-gradient(135deg,#7C3AED 0%,#EC4899 100%)",
  "証券・投資": "linear-gradient(135deg,#10B981 0%,#059669 100%)",
  "チャージルート": "linear-gradient(135deg,#F59E0B 0%,#D97706 100%)"
};
const THUMB_ICON = {
  "カード解説": "💳",
  "キャンペーン": "🎁",
  "証券・投資": "📈",
  "チャージルート": "🔌"
};
const CATEGORY_ORDER = ["すべて", "キャンペーン", "カード解説", "証券・投資", "チャージルート"];

/* PR枠（実データではなく広告枠。運用時はここだけ書き換える） */
const PR_CARD = {
  category: "キャンペーン",
  title: "【2026年8月最新】クレジットカード入会キャンペーンまとめ｜最大15,000ポイントもらえるカードは？",
  overview: "2026年8月時点で実施中のクレジットカード入会キャンペーンを徹底比較。新規入会ポイント還元を中心に、お得なカードを厳選して紹介します。",
  updatedDate: "2026-08-10",
  ctaUrl: "#",
  affKey: "" // affiliates.jsonのキーを設定するとdata-affで自動差し込みされる
};

function esc(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readArticles(){
  const raw = readFileSync(ARTICLES_JSON, "utf-8");
  const list = JSON.parse(raw);
  if(!Array.isArray(list)) throw new Error("articles.json must be an array");
  return list;
}

function metaDescriptionFor(a){
  const src = a.overview || a.leadText || a.title || "";
  return src.length > 110 ? src.slice(0, 110) + "…" : src;
}

function stepsHtml(steps){
  if(!steps || !steps.length) return "";
  return steps.map((s, i) => `
      <div class="lp-flow-step">
        <div class="lp-flow-num">${i + 1}</div>
        <div>${esc(s)}</div>
      </div>
      ${i < steps.length - 1 ? '<div class="lp-flow-arrow">↓</div>' : ""}`).join("\n");
}

function overviewLabel(a){
  return a.category === "カード解説" ? "カードの概要" : "このキャンペーンの概要";
}

function tocHtml(a){
  const items = [
    `<li><a href="#overview">${overviewLabel(a)}</a></li>`,
  ];
  if(a.steps && a.steps.length) items.push(`<li><a href="#steps">使い方の手順</a></li>`);
  if(a.note) items.push(`<li><a href="#note">注意点・詳細条件</a></li>`);
  if(a.period) items.push(`<li><a href="#period">実施期間</a></li>`);
  items.push(`<li><a href="#summary">まとめ</a></li>`);
  return `<div class="lp-toc-title">この記事の内容</div><ol>${items.join("")}</ol>`;
}

function relatedHtml(a, bySlug){
  const rel = (a.related || []).map(slug => bySlug.get(slug)).filter(Boolean).slice(0, 3);
  if(!rel.length) return "";
  return `
    <section class="lp-section">
      <h2 class="lp-section-title">あわせて読みたい</h2>
      <div class="lp-related">
        ${rel.map(r => `<a class="lp-related-item" href="./${r.slug}.html">${esc(r.title)}</a>`).join("\n        ")}
      </div>
    </section>`;
}

function tagsHtml(a){
  if(!a.tags || !a.tags.length) return "";
  return `<p class="lp-body-text" style="font-size:12px;color:var(--dim);">タグ：${a.tags.map(esc).join("　")}</p>`;
}

function periodSectionHtml(a){
  if(!a.period) return "";
  const text = a.expires ? `${a.period}（〜${a.expires}まで）` : a.period;
  return `
    <section class="lp-section">
      <h2 class="lp-section-title" id="period">実施期間</h2>
      <p class="lp-body-text">${esc(text)}</p>
    </section>`;
}

function noteSectionHtml(a){
  if(!a.note) return "";
  return `
    <section class="lp-section">
      <h2 class="lp-section-title" id="note">注意点・詳細条件</h2>
      <p class="lp-body-text">${esc(a.note)}</p>
    </section>`;
}

function stepsSectionHtml(a){
  if(!a.steps || !a.steps.length) return "";
  return `
    <section class="lp-section">
      <h2 class="lp-section-title" id="steps">使い方の手順</h2>
      <div class="lp-flow">
${stepsHtml(a.steps)}
      </div>
    </section>`;
}

function ctaButtonLabel(a){
  const base = a.ctaLabel || "公式ページで詳細を見る";
  return a.affiliate ? `${base}（PR）` : base;
}

function bannerSectionHtml(a){
  if(!a.bannerImageUrl || !a.bannerLinkUrl) return "";
  return `
    <div class="lp-banner-box">
      <div class="lp-banner-label">📣 PR</div>
      <a href="${esc(a.bannerLinkUrl)}" target="_blank" rel="sponsored noopener nofollow">
        <img src="${esc(a.bannerImageUrl)}" alt="${esc(a.bannerAlt || a.title)}" class="lp-banner-img">
      </a>
    </div>`;
}

function articleTemplate(a, bySlug){
  const leadParts = [];
  if(a.rate) leadParts.push(a.rate);
  if(a.period) leadParts.push(a.period);
  const lead = leadParts.length
    ? `${esc(leadParts.join("／"))}で使える、ペイ択がチェックしているキャンペーンです。`
    : "ペイ択がチェックしているキャンペーンです。";

  const pageTitle = `${a.title} | ${SITE_NAME}`;
  const description = metaDescriptionFor(a);
  const canonical = `${SITE_URL}/articles/${a.slug}.html`;

  return `<!DOCTYPE html>
<html lang="ja" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="../assets/articles.css">
</head>
<body>
<header class="site-header">
  <div class="site-header-inner">
    <a class="site-logo" href="../index.html">ペイ<span>択</span></a>
    <span class="site-header-tagline">還元率比較・お得情報</span>
    <button class="theme-toggle" id="themeToggle" aria-label="ダークモード切替" title="ダークモード切替">🌙</button>
  </div>
</header>
<script>
(function(){
  var STORAGE_KEY = 'paytaku-theme';
  var DEFAULT = 'dark';
  var saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
  document.documentElement.setAttribute('data-theme', saved);
  window.addEventListener('DOMContentLoaded', function(){
    var btn = document.getElementById('themeToggle');
    if(!btn) return;
    btn.textContent = saved === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', function(){
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem(STORAGE_KEY, next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  });
})();
</script>

<div class="lp-page">
  <div class="lp-wrap">
    <a href="../index.html" class="lp-back">← ペイ択トップに戻る</a>
    <nav class="lp-breadcrumb">
      <a href="../index.html">ホーム</a> ＞ <a href="./index.html">${esc(a.category || "記事")}</a> ＞ ${esc(a.title.length > 20 ? a.title.slice(0, 20) + "…" : a.title)}
    </nav>

    <div class="lp-hero">
      <div class="lp-badge">${esc(a.category || "今月のおすすめ")}</div>
      <h1 class="lp-title">${esc(a.title)}</h1>
      <p class="lp-tagline">${lead}</p>
      <div class="lp-byline">更新日：${esc(a.updatedDate || a.publishedDate || "")}　|　ペイ択編集部</div>
    </div>

    <nav class="lp-toc">
      ${tocHtml(a)}
    </nav>
${bannerSectionHtml(a)}
    <section class="lp-section">
      <h2 class="lp-section-title" id="overview">${overviewLabel(a)}</h2>
      <p class="lp-body-text">${esc(a.overview || "")}</p>
    </section>
${stepsSectionHtml(a)}
${noteSectionHtml(a)}
${periodSectionHtml(a)}
    <section class="lp-section">
      <h2 class="lp-section-title" id="summary">まとめ</h2>
      <p class="lp-body-text">${esc(a.conclusion || "")}</p>
      ${tagsHtml(a)}
    </section>

    <section class="lp-section lp-cta-section">
      <h2 class="lp-section-title">このキャンペーンを見る</h2>
      <p class="lp-cta-note">条件・還元率は変更される場合があります。ご利用前に必ず公式ページで最新情報をご確認ください。</p>
      <a href="${esc(a.ctaUrl || "#")}"${a.affKey ? ` data-aff="${esc(a.affKey)}"` : ""} class="lp-apply-btn" target="_blank" rel="noopener noreferrer nofollow sponsored">${esc(ctaButtonLabel(a))}</a>
    </section>
${relatedHtml(a, bySlug)}

    <div class="lp-disclosure">本ページの情報は掲載時点のものです。還元率・条件は変更される場合があるため、利用前に必ず公式サイトでご確認ください。本サイトはアフィリエイト広告を含みます。</div>
    <a href="../index.html" class="lp-back lp-back-bottom">← ペイ択トップに戻る</a>
  </div>
</div>
<script src="../assets/affiliates.js"></script>
</body>
</html>
`;
}

function indexTemplate(articles){
  const pageTitle = `記事一覧 | ${SITE_NAME}`;
  const description = "ペイ択が公開している、キャンペーン攻略・カード活用の記事一覧です。";
  const canonical = `${SITE_URL}/articles/index.html`;

  const slim = articles.map(a => ({
    slug: a.slug,
    category: a.category || "その他",
    title: a.title,
    overview: metaDescriptionFor(a),
    updatedDate: a.updatedDate || a.publishedDate || "",
    thumbnail: resolveThumbnail(a.slug, a.thumbnail) // assets/thumbnails/{slug}.png等を自動検出。articles.jsonのthumbnailフィールドがあればそちら優先
  }));
  const articlesJson = JSON.stringify(slim);
  const prJson = JSON.stringify(PR_CARD);
  const thumbGradientJson = JSON.stringify(THUMB_GRADIENT);
  const thumbIconJson = JSON.stringify(THUMB_ICON);
  const categoriesJson = JSON.stringify(CATEGORY_ORDER);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { darkMode: 'class' };</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  :root{
    --fs-page-title:22px; --fs-page-sub:13px; --fs-section:16px;
    --fs-card-title:18px; --fs-card-desc:14px; --fs-tag:11px;
    --fs-date:11px; --fs-nav:10px; --pad-card:16px; --gap-card:16px;
    --pad-edge:16px; --h-btn:48px; --h-nav:64px;
  }
  html.large{
    --fs-page-title:28px; --fs-page-sub:15px; --fs-section:20px;
    --fs-card-title:22px; --fs-card-desc:16px; --fs-tag:12px;
    --fs-date:12px; --fs-nav:12px; --pad-card:20px; --gap-card:20px;
    --pad-edge:20px; --h-btn:56px; --h-nav:72px;
  }
  html.large body{ line-height:1.6; }
  a{ text-decoration:none; }
  *{ -webkit-tap-highlight-color: transparent; }
  body{ max-width:430px; margin:0 auto; font-family:'Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif; }
  .icon-btn{ -webkit-tap-highlight-color:transparent; }
  .icon-btn:active{ background-color:rgba(79,70,229,0.08); }
  html.dark .icon-btn:active{ background-color:rgba(129,140,248,0.15); }
  .card-link{ -webkit-tap-highlight-color:transparent; }
  .card-link:active{ transform:scale(0.99); }
  .thumb-pattern{
    background-image: repeating-linear-gradient(135deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 18px);
  }
  .thumb-16x9{ aspect-ratio:16/9; width:100%; display:flex; align-items:center; justify-content:center; }
  .clamp2{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .fade-in{ animation:fadeIn .25s ease; }
  @keyframes fadeIn{ from{opacity:0; transform:translateY(4px);} to{opacity:1; transform:translateY(0);} }
  @media (prefers-reduced-motion: reduce){ .fade-in{ animation:none; } }
</style>
</head>
<body class="bg-white dark:bg-slate-900 text-[#0F172A] dark:text-slate-100 min-h-screen pb-24">

<header class="sticky top-0 z-50 bg-white dark:bg-slate-900 border-b border-[#E2E8F0] dark:border-slate-700" style="height:56px;">
  <div class="h-full flex items-center justify-between px-4">
    <a href="../index.html" class="flex items-center gap-2">
      <img src="../assets/logo.png" alt="ペイ択" width="22" height="22" class="shrink-0">
      <span class="font-bold text-[15px] text-[#0F172A] dark:text-white">ペイ<span class="text-[#4F46E5]">択</span></span>
    </a>
    <div class="flex items-center gap-1">
      <button id="fontToggle" aria-label="文字サイズ切替" class="icon-btn w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-[#4F46E5] dark:text-indigo-300 bg-[#EEF2FF] dark:bg-indigo-950/60">A+</button>
      <button id="themeToggle" aria-label="ダークモード切替" class="icon-btn w-9 h-9 rounded-full flex items-center justify-center text-[#64748B] dark:text-slate-300">🌙</button>
      <button aria-label="検索" class="icon-btn w-9 h-9 rounded-full flex items-center justify-center text-[#64748B] dark:text-slate-300">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <button id="menuToggle" aria-label="メニュー" aria-expanded="false" class="icon-btn w-9 h-9 rounded-full flex items-center justify-center text-[#64748B] dark:text-slate-300">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M4 7H20M4 12H20M4 17H20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
</header>

<!-- メニューパネル -->
<div id="menuOverlay" class="hidden fixed inset-0 bg-black/40 z-40" style="max-width:430px; margin:0 auto;"></div>
<div id="menuPanel" class="hidden fixed top-0 right-0 h-full bg-white dark:bg-slate-900 z-50 shadow-2xl" style="width:78%; max-width:340px;">
  <div class="flex items-center justify-between px-4 border-b border-[#E2E8F0] dark:border-slate-700" style="height:56px;">
    <span class="font-bold text-[15px] text-[#0F172A] dark:text-white">メニュー</span>
    <button id="menuClose" aria-label="閉じる" class="icon-btn w-9 h-9 rounded-full flex items-center justify-center text-[#64748B] dark:text-slate-300">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
  <nav class="flex flex-col p-2">
    <a href="../index.html" class="px-3 py-3 rounded-lg text-[#0F172A] dark:text-white font-bold hover:bg-[#F8FAFC] dark:hover:bg-slate-800">ホーム</a>
    <a href="./index.html" class="px-3 py-3 rounded-lg text-[#0F172A] dark:text-white font-bold hover:bg-[#F8FAFC] dark:hover:bg-slate-800">記事一覧</a>
    <div class="my-1 border-t border-[#E2E8F0] dark:border-slate-700"></div>
    <button data-menu-cat="キャンペーン" class="text-left px-3 py-3 rounded-lg text-[#64748B] dark:text-slate-300 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">キャンペーン</button>
    <button data-menu-cat="カード解説" class="text-left px-3 py-3 rounded-lg text-[#64748B] dark:text-slate-300 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">カード解説</button>
    <button data-menu-cat="証券・投資" class="text-left px-3 py-3 rounded-lg text-[#64748B] dark:text-slate-300 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">証券・投資</button>
    <button data-menu-cat="チャージルート" class="text-left px-3 py-3 rounded-lg text-[#64748B] dark:text-slate-300 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">チャージルート</button>
  </nav>
</div>

<nav class="bg-[#F8FAFC] dark:bg-slate-800 px-4 py-2 text-[12px] text-[#64748B] dark:text-slate-400">
  <a href="../index.html" class="text-[#4F46E5] dark:text-indigo-300">ホーム</a> &gt; 記事一覧
</nav>

<div class="px-4 py-4 bg-white dark:bg-slate-900">
  <h1 class="font-bold text-[#0F172A] dark:text-white" style="font-size:var(--fs-page-title);">記事一覧</h1>
  <p class="mt-1.5 text-[#64748B] dark:text-slate-400" style="font-size:var(--fs-page-sub);">ペイ択の比較・攻略・カード活用・お得な支払い方法など、もっと生活を豊かにする情報をお届けします。</p>
</div>

<div class="px-4 pb-3 overflow-x-auto whitespace-nowrap" style="scrollbar-width:none;">
  <div class="inline-flex gap-2" id="filterChips"></div>
</div>

<main class="px-4 flex flex-col" id="articleList" style="gap:var(--gap-card);"></main>
<p id="emptyState" class="hidden text-center text-[#94A3B8] dark:text-slate-500 py-10 text-[13px]">このカテゴリの記事は準備中です。</p>

<div class="px-4 mt-4">
  <a href="#" class="w-full flex items-center justify-center rounded-lg border border-[#E2E8F0] dark:border-slate-600 text-[#4F46E5] dark:text-indigo-300 font-bold hover:bg-[#F8FAFC] dark:hover:bg-slate-800" style="height:var(--h-btn);">もっと見る</a>
</div>

<nav class="fixed bottom-0 left-0 right-0 mx-auto bg-white dark:bg-slate-900 border-t border-[#E2E8F0] dark:border-slate-700 flex" style="max-width:430px; height:var(--h-nav); z-index:50;">
  <a href="../index.html" class="flex-1 flex flex-col items-center justify-center gap-1 text-[#4F46E5]">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 11L12 4L21 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10V20H19V10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span class="font-bold" style="font-size:var(--fs-nav);">ホーム</span>
  </a>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 9L12 3L21 9V20H15V14H9V20H3V9Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span style="font-size:var(--fs-nav);">お店から選ぶ</span>
  </button>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 8V13L16 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>
    <span style="font-size:var(--fs-nav);">比較履歴</span>
  </button>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 20C12 20 4 15 4 9.5C4 6.5 6.5 4 9.5 4C11 4 12 5 12 5C12 5 13 4 14.5 4C17.5 4 20 6.5 20 9.5C20 15 12 20 12 20Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span style="font-size:var(--fs-nav);">お気に入り</span>
  </button>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 19V6C4 4.9 4.9 4 6 4H18C19.1 4 20 4.9 20 6V19L12 16L4 19Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    <span style="font-size:var(--fs-nav);">ガイド</span>
  </button>
</nav>

<script>
const ARTICLES = ${articlesJson};
const PR = ${prJson};
const THUMB_GRADIENT = ${thumbGradientJson};
const THUMB_ICON = ${thumbIconJson};
const CATEGORIES = ${categoriesJson};

function fmtDate(s){ if(!s) return ""; const [y,m,d] = s.split("-"); return \`\${y}/\${m}/\${d}\`; }

function thumbHtml(a){
  if(a.thumbnail){
    return \`<div class="thumb-16x9"><img src="\${a.thumbnail}" alt="" class="w-full h-full object-cover" loading="lazy"></div>\`;
  }
  const bg = THUMB_GRADIENT[a.category] || THUMB_GRADIENT["カード解説"];
  const icon = THUMB_ICON[a.category] || "📄";
  return \`<div class="thumb-16x9 thumb-pattern text-white relative" style="background:\${bg};">
    <span style="font-size:56px; filter:drop-shadow(0 2px 6px rgba(0,0,0,0.25));">\${icon}</span>
    <span class="absolute font-extrabold text-white/90" style="right:14px; bottom:10px; font-size:13px; letter-spacing:0.05em; text-shadow:0 1px 4px rgba(0,0,0,0.35);">\${a.category}</span>
  </div>\`;
}

function cardHtml(a){
  return \`
  <a href="./\${a.slug}.html" data-cat="\${a.category}" class="card-link fade-in block bg-[#F8FAFC] dark:bg-slate-800 rounded-2xl overflow-hidden border border-[#E2E8F0]/70 dark:border-slate-700 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
    \${thumbHtml(a)}
    <div style="padding:var(--pad-card);">
      <span class="inline-block rounded-full bg-[#EEF2FF] dark:bg-indigo-950 text-[#4F46E5] dark:text-indigo-300 font-bold px-2 py-0.5" style="font-size:var(--fs-tag);">\${a.category}</span>
      <h3 class="clamp2 font-bold text-[#0F172A] dark:text-white" style="font-size:var(--fs-card-title); margin-top:8px;">\${a.title}</h3>
      <p class="clamp2 text-[#64748B] dark:text-slate-400" style="font-size:var(--fs-card-desc); margin-top:8px;">\${a.overview}</p>
      <p class="text-[#94A3B8] dark:text-slate-500 flex items-center gap-1" style="font-size:var(--fs-date); margin-top:12px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10H21" stroke="currentColor" stroke-width="2"/><path d="M8 3V7M16 3V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        更新日：\${fmtDate(a.updatedDate)}
      </p>
    </div>
  </a>\`;
}

function prHtml(){
  return \`
  <a href="\${PR.ctaUrl}"\${PR.affKey ? \` data-aff="\${PR.affKey}"\` : ""} target="_blank" rel="noopener noreferrer nofollow sponsored"
     class="card-link fade-in block bg-[#FAF5FF] dark:bg-purple-950/40 rounded-2xl overflow-hidden border border-[#D8B4FE] dark:border-purple-800 shadow-[0_2px_8px_rgba(126,34,206,0.08)]">
    <div class="relative">
      <div class="thumb-16x9 thumb-pattern text-white" style="background:linear-gradient(135deg,#7C3AED 0%,#EC4899 100%);"><span style="font-size:56px; filter:drop-shadow(0 2px 6px rgba(0,0,0,0.25));">🎉</span></div>
      <span class="absolute bg-[#7C3AED] text-white font-bold rounded px-2 py-0.5" style="font-size:10px; top:12px; left:12px;">PR</span>
    </div>
    <div style="padding:var(--pad-card);">
      <span class="inline-block rounded-full bg-[#EEF2FF] dark:bg-indigo-950 text-[#4F46E5] dark:text-indigo-300 font-bold px-2 py-0.5" style="font-size:var(--fs-tag);">\${PR.category}</span>
      <h3 class="clamp2 font-bold text-[#0F172A] dark:text-white" style="font-size:var(--fs-card-title); margin-top:8px;">\${PR.title}</h3>
      <p class="clamp2 text-[#64748B] dark:text-slate-400" style="font-size:var(--fs-card-desc); margin-top:8px;">\${PR.overview}</p>
      <div class="flex items-center justify-between" style="margin-top:12px;">
        <span class="text-[#94A3B8] dark:text-slate-500 flex items-center gap-1" style="font-size:var(--fs-date);">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10H21" stroke="currentColor" stroke-width="2"/><path d="M8 3V7M16 3V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          更新日：\${fmtDate(PR.updatedDate || "")}
        </span>
        <span class="text-[#94A3B8] dark:text-slate-500 flex items-center gap-1" style="font-size:var(--fs-date);" title="広告主から提供された情報をもとに作成しています">
          PRについて
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 11V17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/></svg>
        </span>
      </div>
    </div>
  </a>\`;
}

function render(cat){
  const list = document.getElementById('articleList');
  const empty = document.getElementById('emptyState');
  const filtered = cat === "すべて" ? ARTICLES : ARTICLES.filter(a => a.category === cat);
  if(filtered.length === 0){ list.innerHTML = ""; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  let html = "";
  filtered.forEach((a, i) => {
    html += cardHtml(a);
    if(i === 0 && cat === "すべて") html += prHtml(); // 1件目の直後にPRを1枚だけ挿入（全件表示時のみ）
  });
  list.innerHTML = html;
}

function styleChips(){
  document.querySelectorAll('.chip').forEach(b => {
    if(b.classList.contains('active-chip')){
      b.style.background = '#4F46E5'; b.style.color = '#fff'; b.style.borderColor = '#4F46E5';
    } else {
      b.style.background = ''; b.style.color = '#64748B'; b.style.borderColor = '#E2E8F0';
    }
  });
}

const chipsEl = document.getElementById('filterChips');
chipsEl.innerHTML = CATEGORIES.map((c,i) => \`<button data-cat="\${c}" class="chip\${i===0?' active-chip':''} rounded-full border px-4 py-2 font-bold" style="font-size:var(--fs-tag);height:36px;">\${c}</button>\`).join("");
chipsEl.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    chipsEl.querySelectorAll('.chip').forEach(b => b.classList.remove('active-chip'));
    btn.classList.add('active-chip');
    styleChips();
    render(btn.dataset.cat);
  });
});
styleChips();

/* メニューパネル */
const menuToggle = document.getElementById('menuToggle');
const menuPanel = document.getElementById('menuPanel');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');
function openMenu(){
  menuPanel.classList.remove('hidden');
  menuOverlay.classList.remove('hidden');
  menuToggle.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}
function closeMenu(){
  menuPanel.classList.add('hidden');
  menuOverlay.classList.add('hidden');
  menuToggle.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}
menuToggle.addEventListener('click', openMenu);
menuClose.addEventListener('click', closeMenu);
menuOverlay.addEventListener('click', closeMenu);
document.querySelectorAll('[data-menu-cat]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.menuCat;
    const chip = chipsEl.querySelector(\`[data-cat="\${CSS.escape(cat)}"]\`);
    if(chip) chip.click();
    closeMenu();
    document.getElementById('articleList').scrollIntoView({behavior:'smooth', block:'start'});
  });
});

const FS_KEY = 'paytaku-fontsize';
function applyFontSize(v){ document.documentElement.classList.toggle('large', v === 'large'); }
let fs = localStorage.getItem(FS_KEY) || 'normal';
applyFontSize(fs);
document.getElementById('fontToggle').addEventListener('click', () => {
  fs = fs === 'large' ? 'normal' : 'large';
  localStorage.setItem(FS_KEY, fs);
  applyFontSize(fs);
});

const THEME_KEY = 'paytaku-theme';
function applyTheme(v){
  document.documentElement.classList.toggle('dark', v === 'dark');
  document.getElementById('themeToggle').textContent = v === 'dark' ? '☀️' : '🌙';
}
let theme = localStorage.getItem(THEME_KEY) || 'light';
applyTheme(theme);
document.getElementById('themeToggle').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
});

render('すべて');
</script>
<script src="../assets/affiliates.js"></script>
</body>
</html>
`;
}


function main(){
  const articles = readArticles();
  const bySlug = new Map(articles.map(a => [a.slug, a]));

  mkdirSync(OUT_DIR, { recursive: true });

  const thumbHits = articles.filter(a => resolveThumbnail(a.slug, a.thumbnail)).length;
  console.log(`サムネイル画像: ${thumbHits}/${articles.length} 件を検出（assets/thumbnails/ + articles.json）`);

  articles.forEach(a => {
    if(!a.slug) throw new Error(`記事に slug がありません: ${a.title}`);
    // customHtml=true の記事は、標準テンプレートに収まらない診断・比較などの
    // 独立HTMLをリポジトリで直接管理している。上書きすると手作業の内容が消えるため、
    // ここではHTML生成をスキップし、記事一覧（index.html）にだけ載せる。
    if(a.customHtml){
      console.log(`skipped (customHtml): articles/${a.slug}.html`);
      return;
    }
    const html = articleTemplate(a, bySlug);
    writeFileSync(join(OUT_DIR, `${a.slug}.html`), html, "utf-8");
    console.log(`generated: articles/${a.slug}.html`);
  });

  writeFileSync(join(OUT_DIR, "index.html"), indexTemplate(articles), "utf-8");
  console.log(`generated: articles/index.html`);

  // sitemap.xml も記事一覧から自動生成する（記事を追加したら検索エンジンに拾われるように）
  writeFileSync(join(ROOT, "sitemap.xml"), sitemapXml(articles), "utf-8");
  console.log(`generated: sitemap.xml`);

  console.log(`\n合計 ${articles.length} 件の記事を生成しました。`);
}

function sitemapXml(articles){
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  const push = (loc, freq, pri, lastmod) => {
    rows.push(`  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>
  </url>`);
  };
  push(`${SITE_URL}/`, "weekly", "1.0", today);
  push(`${SITE_URL}/articles/`, "weekly", "0.8", today);
  articles.forEach(a => {
    const lastmod = a.updatedDate || a.publishedDate || today;
    push(`${SITE_URL}/articles/${a.slug}.html`, "monthly", "0.7", lastmod);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join("\n")}
</urlset>
`;
}

main();
