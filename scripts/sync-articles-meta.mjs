#!/usr/bin/env node
/**
 * sync-articles-meta.mjs
 *
 * articles/*.html の中に埋め込まれた <!--ARTICLE_META ... ARTICLE_META--> ブロックを読み取り、
 * content/articles.json にエントリを自動で追加・更新する。
 *
 * これにより、customHtml:true の記事（診断UIなど独自HTMLで作る記事）を追加・更新するとき、
 * 記事HTMLファイル1つを書く/直すだけで articles.json への反映を忘れなくなる。
 *
 * 対象は ARTICLE_META ブロックを持つファイルだけ。build-articles.mjs が生成する
 * テンプレート記事（articles.json が正でHTMLはそこから生成される側）は対象外。
 *
 * 使い方:
 *   node scripts/sync-articles-meta.mjs
 *
 * 実行タイミング: build-articles.mjs より必ず先に実行する
 * （GitHub Actionsのワークフローで sync → build の順にステップを並べる）。
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTICLES_JSON = join(ROOT, "content", "articles.json");
const ARTICLES_DIR = join(ROOT, "articles");

const META_RE = /<!--\s*ARTICLE_META\s*([\s\S]*?)\s*ARTICLE_META\s*-->/;

function readArticlesJson() {
  const raw = readFileSync(ARTICLES_JSON, "utf-8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("articles.json must be an array");
  return list;
}

function extractMeta(htmlPath) {
  const html = readFileSync(htmlPath, "utf-8");
  const m = html.match(META_RE);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`ARTICLE_META のJSONが壊れています: ${htmlPath}\n${e.message}`);
  }
}

function main() {
  const articles = readArticlesJson();
  const bySlug = new Map(articles.map((a) => [a.slug, a]));

  const files = readdirSync(ARTICLES_DIR).filter(
    (f) => f.endsWith(".html") && f !== "index.html"
  );

  let added = 0;
  let updated = 0;

  for (const file of files) {
    const slugFromFile = file.replace(/\.html$/, "");
    const meta = extractMeta(join(ARTICLES_DIR, file));
    if (!meta) continue; // ARTICLE_META が無いファイルは対象外（テンプレ生成側の記事など）

    if (!meta.slug) {
      throw new Error(`ARTICLE_META に slug がありません: ${file}`);
    }
    if (meta.slug !== slugFromFile) {
      throw new Error(
        `ARTICLE_META の slug (${meta.slug}) がファイル名 (${slugFromFile}.html) と一致しません`
      );
    }

    const entry = { ...meta, customHtml: true };
    const existing = bySlug.get(meta.slug);

    if (!existing) {
      articles.push(entry);
      bySlug.set(meta.slug, entry);
      added++;
      console.log(`added:   ${meta.slug}`);
    } else if (JSON.stringify(existing) !== JSON.stringify(entry)) {
      Object.assign(existing, entry);
      updated++;
      console.log(`updated: ${meta.slug}`);
    }
  }

  writeFileSync(ARTICLES_JSON, JSON.stringify(articles, null, 2) + "\n", "utf-8");
  console.log(`\n完了：追加 ${added} 件 / 更新 ${updated} 件（対象ファイル ${files.length} 件中）`);
}

main();
