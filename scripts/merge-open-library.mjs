#!/usr/bin/env node
// 把「种子 Wikimedia GIF（curated-exercises.js）」和「匹配脚本生成的免费图数据
// （matched-open-exercise-data.js）」合并，写回 open-exercise-data.js。
// 公开原型只加载 open-exercise-data.js（window.OPEN_EXERCISES）。
//
// 用法：node scripts/merge-open-library.mjs
// 依赖：先运行 node scripts/match-free-images.mjs 生成 matched-open-exercise-data.js。

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function readWindowArray(file, varName) {
  const src = readFileSync(file, 'utf8');
  const fn = new Function('window', `"use strict";\n${src}\nreturn window.${varName};`);
  return fn({});
}

const curated = readWindowArray(join(ROOT, 'prototype/curated-exercises.js'), 'CURATED_EXERCISES');
const matched = readWindowArray(join(ROOT, 'prototype/matched-open-exercise-data.js'), 'MATCHED_EXERCISES');

// 去重：matched 中来自 Wikimedia 且 sourceUrl 已出现在种子里 → 跳过（保留种子里的中文版）
const curatedSources = new Set(curated.map((x) => x.sourceUrl));
const deduped = matched.filter((x) => !(x.source === 'wikimedia' && curatedSources.has(x.sourceUrl)));
const removed = matched.length - deduped.length;

// 去掉内部字段 sourceId，保留 source / matchQuality 便于抽查
const merged = [...curated, ...deduped.map(({ sourceId, ...rest }) => rest)];

const cjk = (s) => /[一-鿿]/.test(s);
const zhCount = merged.filter((x) => cjk(x.name)).length;

writeFileSync(
  join(ROOT, 'prototype/open-exercise-data.js'),
  `window.OPEN_EXERCISES = ${JSON.stringify(merged, null, 2)};\n`,
  'utf8'
);

console.log(`合并完成：种子 ${curated.length} + 匹配 ${deduped.length}（去重 ${removed}）= 共 ${merged.length} 条`);
console.log(`中文名：${zhCount}，英文名：${merged.length - zhCount}`);
