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
      <a href="${esc(a.ctaUrl || "#")}" class="lp-apply-btn" target="_blank" rel="noopener noreferrer">${esc(ctaButtonLabel(a))}</a>
    </section>
${relatedHtml(a, bySlug)}

    <div class="lp-disclosure">本ページの情報は掲載時点のものです。還元率・条件は変更される場合があるため、利用前に必ず公式サイトでご確認ください。本サイトはアフィリエイト広告を含みます。</div>
    <a href="../index.html" class="lp-back lp-back-bottom">← ペイ択トップに戻る</a>
  </div>
</div>
</body>
</html>
`;
}

function indexTemplate(articles){
  const pageTitle = `記事一覧 | ${SITE_NAME}`;
  const description = "ペイ択が公開している、キャンペーン攻略・カード活用の記事一覧です。";
  const canonical = `${SITE_URL}/articles/index.html`;

  const byCategory = new Map();
  articles.forEach(a => {
    const cat = a.category || "その他";
    if(!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(a);
  });

  const sections = [...byCategory.entries()].map(([cat, items]) => `
    <section class="lp-section">
      <h2 class="lp-section-title">${esc(cat)}</h2>
      <div class="article-list">
        ${items.map(a => `
        <a class="article-list-item" href="./${a.slug}.html">
          <span class="article-list-cat">${esc(a.category || "")}</span>
          <div class="article-list-title">${esc(a.title)}</div>
          <div class="article-list-desc">${esc(metaDescriptionFor(a))}</div>
        </a>`).join("\n        ")}
      </div>
    </section>`).join("\n");

  return `<!DOCTYPE html>
<html lang="ja" data-theme="dark">
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
    <div class="lp-hero">
      <h1 class="lp-title">記事一覧</h1>
      <p class="lp-tagline">キャンペーン攻略・カード活用の記事をまとめています。</p>
    </div>
${sections}
    <div class="lp-disclosure">本サイトはアフィリエイト広告を含みます。</div>
    <a href="../index.html" class="lp-back lp-back-bottom">← ペイ択トップに戻る</a>
  </div>
</div>
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
