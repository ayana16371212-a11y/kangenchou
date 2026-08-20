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

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTICLES_JSON = join(ROOT, "content", "articles.json");
const OUT_DIR = join(ROOT, "articles");

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
  title: "【2026年8月最新】クレジットカード入会キャンペーンまとめ｜最大15,000ポイントもらえるカードは？",
  overview: "2026年8月時点で実施中のクレジットカード入会キャンペーンを徹底比較。新規入会ポイント還元を中心に、お得なカードを厳選して紹介します。",
  ctaLabel: "詳細を見る",
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

  // クライアント側フィルタリング用に、必要なフィールドだけ軽量化してJSへ埋め込む
  const slim = articles.map(a => ({
    slug: a.slug,
    category: a.category || "その他",
    title: a.title,
    overview: metaDescriptionFor(a),
    updatedDate: a.updatedDate || a.publishedDate || "",
    thumbnail: a.thumbnail || null // articles.jsonに thumbnail: "https://..." を追加すると実画像が使われる
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
<script src="https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/3.4.1/tailwind.min.js"></script>
<script>tailwind.config = { darkMode: 'class' };</script>
<style>
  :root{
    --fs-page-title:22px; --fs-page-sub:13px; --fs-section:16px;
    --fs-card-title:16px; --fs-card-desc:13px; --fs-tag:11px;
    --fs-date:11px; --fs-nav:10px; --pad-card:16px; --gap-card:12px;
    --pad-edge:16px; --h-btn:48px; --h-nav:64px;
  }
  html.large{
    --fs-page-title:28px; --fs-page-sub:15px; --fs-section:20px;
    --fs-card-title:20px; --fs-card-desc:15px; --fs-tag:12px;
    --fs-date:12px; --fs-nav:12px; --pad-card:20px; --gap-card:16px;
    --pad-edge:20px; --h-btn:56px; --h-nav:72px;
  }
  html.large body{ line-height:1.6; }
  body{ max-width:430px; margin:0 auto; }
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
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3V21" stroke="#4F46E5" stroke-width="2" stroke-linecap="round"/>
        <path d="M5 7H19" stroke="#4F46E5" stroke-width="2" stroke-linecap="round"/>
        <path d="M5 7L2 13C2 15 3.5 16 5 16C6.5 16 8 15 8 13L5 7Z" stroke="#4F46E5" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M19 7L16 13C16 15 17.5 16 19 16C20.5 16 22 15 22 13L19 7Z" stroke="#4F46E5" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M9 21H15" stroke="#4F46E5" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span class="font-bold text-[15px] text-[#0F172A] dark:text-white">ペイ<span class="text-[#4F46E5]">択</span></span>
    </a>
    <div class="flex items-center gap-1.5">
      <button id="fontToggle" aria-label="文字サイズ切替" class="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold border border-[#E2E8F0] dark:border-slate-600 text-[#4F46E5] dark:text-indigo-300 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">A+</button>
      <button id="themeToggle" aria-label="ダークモード切替" class="w-10 h-10 rounded-full flex items-center justify-center border border-[#E2E8F0] dark:border-slate-600 hover:bg-[#F8FAFC] dark:hover:bg-slate-800">🌙</button>
    </div>
  </div>
</header>

<nav class="bg-[#F8FAFC] dark:bg-slate-800 px-4 py-2 text-[12px] text-[#64748B] dark:text-slate-400">
  <a href="../index.html" class="hover:text-[#4F46E5]">ホーム</a> &gt; 記事一覧
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
  <a href="../index.html" class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 11L12 4L21 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10V20H19V10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span style="font-size:var(--fs-nav);">ホーム</span>
  </a>
  <a href="./index.html" class="flex-1 flex flex-col items-center justify-center gap-1 text-[#4F46E5]">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 9H16M8 13H16M8 17H12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span class="font-bold" style="font-size:var(--fs-nav);">記事</span>
  </a>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span style="font-size:var(--fs-nav);">検索</span>
  </button>
  <button class="flex-1 flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-slate-400">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20C4 16 7.5 14 12 14C16.5 14 20 16 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <span style="font-size:var(--fs-nav);">マイページ</span>
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
    return \`<img src="\${a.thumbnail}" alt="" class="shrink-0 rounded-xl object-cover" style="width:88px;height:88px;" loading="lazy">\`;
  }
  const bg = THUMB_GRADIENT[a.category] || THUMB_GRADIENT["カード解説"];
  const icon = THUMB_ICON[a.category] || "📄";
  return \`<div class="shrink-0 rounded-xl flex items-center justify-center text-white" style="width:88px;height:88px;font-size:32px;background:\${bg};">\${icon}</div>\`;
}

function cardHtml(a){
  return \`
  <a href="./\${a.slug}.html" data-cat="\${a.category}" class="fade-in flex bg-[#F8FAFC] dark:bg-slate-800 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.08)]" style="padding:var(--pad-card);">
    \${thumbHtml(a)}
    <div class="flex-1 min-w-0" style="margin-left:12px;">
      <span class="inline-block rounded-full bg-[#EEF2FF] dark:bg-indigo-950 text-[#4F46E5] dark:text-indigo-300 font-bold px-2 py-0.5" style="font-size:var(--fs-tag);">\${a.category}</span>
      <h3 class="clamp2 font-bold mt-1 text-[#0F172A] dark:text-white" style="font-size:var(--fs-card-title);">\${a.title}</h3>
      <p class="clamp2 mt-1 text-[#64748B] dark:text-slate-400" style="font-size:var(--fs-card-desc);">\${a.overview}</p>
      <p class="mt-1.5 text-[#94A3B8] dark:text-slate-500 flex items-center gap-1" style="font-size:var(--fs-date);">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10H21" stroke="currentColor" stroke-width="2"/><path d="M8 3V7M16 3V7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        更新日：\${fmtDate(a.updatedDate)}
      </p>
    </div>
  </a>\`;
}

function prHtml(){
  return \`
  <a href="\${PR.ctaUrl}"\${PR.affKey ? \` data-aff="\${PR.affKey}"\` : ""} target="_blank" rel="noopener noreferrer nofollow sponsored"
     class="fade-in flex bg-[#FAF5FF] dark:bg-purple-950/40 rounded-xl border border-[#D8B4FE] dark:border-purple-800 shadow-[0_1px_3px_rgba(126,34,206,0.08)]" style="padding:var(--pad-card);">
    <div class="shrink-0 relative rounded-xl flex items-center justify-center text-white" style="width:88px;height:88px;font-size:32px;background:linear-gradient(135deg,#7C3AED 0%,#EC4899 100%);">
      🎉
      <span class="absolute -top-2 -left-2 bg-[#7C3AED] text-white font-bold rounded px-2 py-0.5" style="font-size:10px;">PR</span>
    </div>
    <div class="flex-1 min-w-0" style="margin-left:12px;">
      <h3 class="clamp2 font-bold text-[#0F172A] dark:text-white" style="font-size:var(--fs-card-title);">\${PR.title}</h3>
      <p class="clamp2 mt-1 text-[#64748B] dark:text-slate-400" style="font-size:var(--fs-card-desc);">\${PR.overview}</p>
      <span class="inline-block mt-1.5 text-[#7C3AED] dark:text-purple-300 font-bold" style="font-size:var(--fs-date);">\${PR.ctaLabel} →</span>
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
    if(i === 2 && cat === "すべて") html += prHtml();
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
