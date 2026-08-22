#!/usr/bin/env node
// 把本地 1324 个 MIT 动作数据（prototype/exercise-data.js）按英文名，
// 匹配免费授权的示范图片。匹配源按优先级：
//   1. 已接入的 Wikimedia Commons GIF（prototype/open-exercise-data.js）
//   2. FreeExerciseDB（Unlicense / 公共领域，873 动作 + 照片）
//   3. wger.de（CC-BY-SA，268 动作有图）
//
// 输出：
//   prototype/matched-open-exercise-data.js  可合并进公开原型的数据（window.MATCHED_EXERCISES）
//   scripts/match-report.md                  匹配报告（匹配率、许可说明、注意事项）
//   scripts/unmatched-exercises.json         未匹配到免费图的动作清单（供手动补图）
//
// 用法：node scripts/match-free-images.mjs [--refresh]
//   --refresh  忽略本地缓存，重新拉取外部数据

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.cache');
const REFRESH = process.argv.includes('--refresh');
const DELAY_MS = 120;

const WGER = 'https://wger.de/api/v2/';
const FEDB_DATA_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json';
const FEDB_IMG_BASE = 'https://yuhonas.github.io/free-exercise-db/exercises/';
const FEDB_SOURCE_URL = 'https://github.com/yuhonas/free-exercise-db';

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// 宽松键：再去掉词尾复数 s/es/ies，用于“push-ups ↔ push-up”这类差异。仅在候选唯一时采用。
function looseKey(s) {
  return norm(s)
    .split(' ')
    .map((w) => w.replace(/(ies|es|s)$/, ''))
    .filter(Boolean)
    .join(' ');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(DELAY_MS * (i + 1));
    }
  }
  throw lastErr;
}

function readCache(name) {
  const f = join(CACHE_DIR, name);
  return !REFRESH && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
function writeCache(name, data) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, name), JSON.stringify(data), 'utf8');
}

// 分页拉取 wger 某个 endpoint 的全部结果。
async function fetchAllWger(endpoint, params = {}) {
  const key = `wger-${endpoint.replace(/\//g, '_')}-${Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}.json`;
  const cached = readCache(key);
  if (cached) return cached;

  const qs = new URLSearchParams({ ...params, limit: '500', format: 'json' });
  let url = `${WGER}${endpoint}?${qs.toString()}`;
  const all = [];
  while (url) {
    const data = await fetchJson(url);
    all.push(...data.results);
    url = data.next || null;
    await sleep(DELAY_MS);
  }
  writeCache(key, all);
  return all;
}

// 拉取 FreeExerciseDB 全量数据（单个 JSON）。
async function fetchFedb() {
  const cached = readCache('free-exercise-db.json');
  if (cached) return cached;
  const data = await fetchJson(FEDB_DATA_URL);
  writeCache('free-exercise-db.json', data);
  return data;
}

// ---------------------------------------------------------------------------
// 读取本地数据
// ---------------------------------------------------------------------------

function readWindowArray(file, varName) {
  const src = readFileSync(file, 'utf8');
  // 文件形如 `window.VAR = [ ... ];`，可能是 JSON 或 JS 字面量，统一用 Function 求值（本地自有文件）。
  const fn = new Function('window', `"use strict";\n${src}\nreturn window.${varName};`);
  return fn({});
}

const real = readWindowArray(join(ROOT, 'prototype/exercise-data.js'), 'REAL_EXERCISES');
const curated = readWindowArray(join(ROOT, 'prototype/curated-exercises.js'), 'CURATED_EXERCISES');
console.log(`本地动作：${real.length} 条，已接入 Wikimedia GIF：${curated.length} 条`);

// ---------------------------------------------------------------------------
// 构建候选源索引（统一结构：{ image, gif, author, license, licenseUrl, sourceUrl, source }）
// ---------------------------------------------------------------------------

function indexCandidates(entries, build) {
  const exact = new Map();
  const loose = new Map();
  for (const key of entries.keys()) {
    const media = build(key);
    if (!media) continue;
    if (!exact.has(norm(key))) exact.set(norm(key), media);
    if (!loose.has(looseKey(key))) loose.set(looseKey(key), media);
  }
  return { exact, loose };
}

// 1) Wikimedia 已接入条目
const curatedExact = new Map();
const curatedLoose = new Map();
for (const c of curated) {
  const media = {
    image: c.image, gif: c.gif, author: c.author, license: c.license,
    licenseUrl: c.licenseUrl, sourceUrl: c.sourceUrl, source: 'wikimedia',
  };
  curatedExact.set(norm(c.englishName), media);
  curatedLoose.set(looseKey(c.englishName), media);
}

// 2) FreeExerciseDB
console.log('拉取 FreeExerciseDB 数据……');
const fedb = await fetchFedb();
const fedbExact = new Map();
const fedbLoose = new Map();
for (const e of fedb) {
  if (!e.images || !e.images.length) continue;
  const img = FEDB_IMG_BASE + e.images[0];
  const gif = e.images[1] ? FEDB_IMG_BASE + e.images[1] : img;
  const media = {
    image: img, gif, author: 'FreeExerciseDB', license: 'Public domain',
    licenseUrl: 'https://unlicense.org/', sourceUrl: FEDB_SOURCE_URL, source: 'free-exercise-db',
  };
  if (!fedbExact.has(norm(e.name))) fedbExact.set(norm(e.name), media);
  if (!fedbLoose.has(looseKey(e.name))) fedbLoose.set(looseKey(e.name), media);
}
// 模糊匹配用：FreeExerciseDB 基础动作名（>= 2 词），按长度降序，
// 供“变式名包含基础动作名”时兜底（如 assisted hanging knee raise -> hanging knee raise）。
const fedbFuzzy = fedb
  .filter((e) => e.images && e.images.length)
  .map((e) => {
    const img = FEDB_IMG_BASE + e.images[0];
    const gif = e.images[1] ? FEDB_IMG_BASE + e.images[1] : img;
    return {
      n: norm(e.name),
      media: {
        image: img, gif, author: 'FreeExerciseDB', license: 'Public domain',
        licenseUrl: 'https://unlicense.org/', sourceUrl: FEDB_SOURCE_URL, source: 'free-exercise-db',
      },
    };
  })
  .filter((x) => x.n.split(' ').length >= 2)
  .sort((a, b) => b.n.length - a.n.length);

function fuzzyFedbMatch(gymNorm) {
  const needle = ' ' + gymNorm + ' ';
  // 方向1（优先）：基础动作名被变式名包含（assisted X -> X），取最长（最具体）。
  for (const x of fedbFuzzy) {
    if (needle.includes(' ' + x.n + ' ')) return x.media;
  }
  // 方向2：变式名更短、被基础名包含（bench press -> barbell bench press），取最短（最接近）。
  for (let i = fedbFuzzy.length - 1; i >= 0; i--) {
    const hay = ' ' + fedbFuzzy[i].n + ' ';
    if (hay.includes(needle)) return fedbFuzzy[i].media;
  }
  return null;
}

console.log(`FreeExerciseDB：${fedb.length} 动作，${fedbExact.size} 个英文名索引`);

// 3) wger
console.log('拉取 wger 动作名、图片、许可数据……');
const [translations, images, licenses] = await Promise.all([
  fetchAllWger('exercise-translation/', { language: '2' }),
  fetchAllWger('exerciseimage/'),
  fetchAllWger('license/'),
]);
const licenseById = new Map(licenses.map((l) => [l.id, l]));
function licenseLabel(licenseId) {
  const short = (licenseById.get(licenseId) && licenseById.get(licenseId).short_name) || '';
  if (/CC-BY-SA 3/i.test(short)) return 'CC BY-SA 3.0';
  if (/CC-BY-SA 4/i.test(short)) return 'CC BY-SA 4.0';
  if (/CC-BY 4/i.test(short)) return 'CC BY 4.0';
  if (/CC0/i.test(short) || /Public Domain/i.test(short)) return 'Public domain';
  return short || '见 licenseUrl';
}
const namesByExercise = new Map();
for (const t of translations) {
  if (!namesByExercise.has(t.exercise)) namesByExercise.set(t.exercise, []);
  namesByExercise.get(t.exercise).push(t.name);
}
const imageByExercise = new Map();
for (const img of images) {
  if (!img.image) continue;
  const existing = imageByExercise.get(img.exercise);
  if (!existing || (img.is_main && !existing.is_main)) imageByExercise.set(img.exercise, img);
}
const wgerExact = new Map();
const wgerLoose = new Map();
for (const [exerciseId, img] of imageByExercise) {
  const names = namesByExercise.get(exerciseId) || [];
  const licenseId = img.license;
  const media = {
    image: img.image, gif: img.image,
    author: img.license_author || 'wger.de contributors',
    license: licenseLabel(licenseId),
    licenseUrl: (licenseById.get(licenseId) && licenseById.get(licenseId).url) || '',
    sourceUrl: img.image, source: 'wger',
  };
  for (const name of names) {
    if (!wgerExact.has(norm(name))) wgerExact.set(norm(name), media);
    if (!wgerLoose.has(looseKey(name))) wgerLoose.set(looseKey(name), media);
  }
}
console.log(`wger：${imageByExercise.size} 个动作有图`);

// ---------------------------------------------------------------------------
// 匹配
// ---------------------------------------------------------------------------

const SOURCES = [
  { exact: curatedExact, loose: curatedLoose },
  { exact: fedbExact, loose: fedbLoose },
  { exact: wgerExact, loose: wgerLoose },
];

function matchOne(ex) {
  const key = norm(ex.englishName);
  const lkey = looseKey(ex.englishName);
  for (const s of SOURCES) {
    if (s.exact.has(key)) return { media: s.exact.get(key), tier: 'exact' };
  }
  for (const s of SOURCES) {
    if (s.loose.has(lkey)) return { media: s.loose.get(lkey), tier: 'loose' };
  }
  // 模糊：变式名包含 FreeExerciseDB 基础动作名（>= 2 词），按最长匹配
  if (key.split(' ').length >= 2) {
    const m = fuzzyFedbMatch(key);
    if (m) return { media: m, tier: 'fuzzy' };
  }
  return null;
}

const matched = [];
const unmatched = [];
const stats = { 'free-exercise-db': 0, wikimedia: 0, wger: 0, exact: 0, loose: 0, fuzzy: 0 };

for (const ex of real) {
  const hit = matchOne(ex);
  if (!hit) {
    unmatched.push({ id: ex.id, englishName: ex.englishName, name: ex.name });
    continue;
  }
  stats[hit.media.source]++;
  stats[hit.tier]++;

  matched.push({
    id: `free-${ex.id}`,
    sourceId: ex.id,
    name: ex.name,
    englishName: ex.englishName,
    part: ex.part,
    equipment: ex.equipment,
    target: ex.target,
    secondaryMuscles: ex.secondaryMuscles || [],
    image: hit.media.image,
    gif: hit.media.gif,
    steps: ex.steps || [],
    author: hit.media.author,
    license: hit.media.license,
    licenseUrl: hit.media.licenseUrl,
    sourceUrl: hit.media.sourceUrl,
    source: hit.media.source,
    matchQuality: hit.tier,
  });
}

// ---------------------------------------------------------------------------
// 写输出
// ---------------------------------------------------------------------------

const dataOut = join(ROOT, 'prototype/matched-open-exercise-data.js');
writeFileSync(
  dataOut,
  `window.MATCHED_EXERCISES = ${JSON.stringify(matched, null, 2)};\n`,
  'utf8'
);
writeFileSync(
  join(ROOT, 'scripts/unmatched-exercises.json'),
  JSON.stringify(unmatched, null, 2) + '\n',
  'utf8'
);

const rate = ((matched.length / real.length) * 100).toFixed(1);
const report = [
  '# 免费图匹配报告',
  '',
  `- 本地动作总数：**${real.length}**`,
  `- 匹配到免费图：**${matched.length}**（匹配率 ${rate}%）`,
  `  - FreeExerciseDB（公共领域）：${stats['free-exercise-db']}`,
  `  - Wikimedia Commons GIF：${stats.wikimedia}`,
  `  - wger.de（CC-BY-SA）：${stats.wger}`,
  `  - 精确名匹配：${stats.exact}，宽松匹配（仅去复数）：${stats.loose}，模糊匹配（变式->基础动作）：${stats.fuzzy}`,
  `- 未匹配：**${unmatched.length}**，清单见 \`scripts/unmatched-exercises.json\``,
  '',
  '## 产出文件',
  '',
  '- `prototype/matched-open-exercise-data.js`：`window.MATCHED_EXERCISES`，字段与 `open-exercise-data.js` 一致，可直接合并进公开原型。',
  '- `scripts/unmatched-exercises.json`：仍未找到免费图的动作，可手动补图或暂时不放图。',
  '',
  '## 许可说明',
  '',
  '- 动作**文字数据**（名称、步骤、部位、器械、目标肌群）来自你本地 MIT 数据集，可自由使用。',
  '- **FreeExerciseDB**：代码与数据为 Unlicense（公共领域），可自由商用、无需署名；但“仓库许可”不完全等于“每张照片的权利”，正式商用前建议抽查个别图片来源。',
  '- **wger**：图片为 CC 授权，需保留 `author` / `license` / `licenseUrl` / `sourceUrl` 署名字段；`license_author` 为空时回退为 `wger.de contributors`。',
  '- **Wikimedia**：沿用你已有的署名字段。',
  '- 图片当前为**热链**到 FreeExerciseDB / wger 的站点；用于正式产品时建议下载到本地仓库（与现有 `assets/open-exercises/` 一致），避免外站变动影响显示。',
  '- 少量同名不同变式（宽握/窄握）可能配到近似图，使用前请抽查。',
  '',
].join('\n');
writeFileSync(join(ROOT, 'scripts/match-report.md'), report, 'utf8');

console.log(`\n完成：匹配 ${matched.length}/${real.length}（${rate}%）`);
console.log(`  FreeExerciseDB ${stats['free-exercise-db']} / Wikimedia ${stats.wikimedia} / wger ${stats.wger}`);
console.log(`  数据文件：prototype/matched-open-exercise-data.js`);
console.log(`  报告：scripts/match-report.md`);
console.log(`  未匹配：scripts/unmatched-exercises.json（${unmatched.length} 条）`);
