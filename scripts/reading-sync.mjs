/**
 * 翻頁之後：從 Notion 讀取四個資料庫 → 統一欄位 → 查封面、取主色 → 輸出 reading/data.json
 *
 *   node --env-file=.env scripts/reading-sync.mjs          讀取真實 Notion（需要 .env 的 NOTION_TOKEN）
 *   node scripts/reading-sync.mjs --mock                     用 test/fixtures/ 的模擬資料（不連 Notion）
 *
 * 需要 sharp：npm install --no-save sharp@0.33.5
 *
 * 環境變數：
 *   NOTION_TOKEN      Notion Integration 的密鑰（必填）
 *   TMDB_TOKEN        TMDB 的 API Read Access Token 或 API Key（選填，電影／影劇封面）
 *   GOOGLE_BOOKS_KEY  Google Books API Key（選填，不填也能查，只是次數較少）
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "reading");
const COVER_DIR = path.join(SITE, "covers");
const CACHE_FILE = path.join(ROOT, ".cache", "reading-sync.json");

const MOCK = process.argv.includes("--mock");
const LOOKUP = !MOCK || process.argv.includes("--lookup");
const { NOTION_TOKEN, TMDB_TOKEN, GOOGLE_BOOKS_KEY } = process.env;

const config = JSON.parse(await fs.readFile(path.join(ROOT, "scripts", "reading.config.json"), "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn("⚠️ ", ...a);

/* ───────────── Notion API ───────────── */
let lastCall = 0;
async function notion(method, url, body) {
  // Notion 限制每秒約 3 次請求
  const wait = 350 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 5; attempt++) {
    lastCall = Date.now();
    const res = await fetch(`https://api.notion.com/v1/${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
      continue;
    }
    const json = await res.json();
    if (!res.ok) {
      const hint = res.status === 404
        ? "（找不到資料庫：請確認 ID 正確，並已在該資料庫的「連線」加入你的 Integration）"
        : res.status === 401 ? "（密鑰錯誤：請檢查 NOTION_TOKEN）" : "";
      throw new Error(`Notion ${res.status} ${json.code}: ${json.message}${hint}`);
    }
    return json;
  }
  throw new Error("Notion 請求次數過多，請稍後再試");
}

async function fetchDatabase(db) {
  if (MOCK) {
    const { mockDatabases } = await import("../test/fixtures/reading-mock-notion.mjs");
    return mockDatabases[db.category] ?? { schema: { properties: {} }, pages: [], blocks: {} };
  }
  const schema = await notion("GET", `databases/${db.id}`);
  const pages = [];
  let cursor;
  do {
    const r = await notion("POST", `databases/${db.id}/query`, {
      page_size: 100,
      start_cursor: cursor,
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
    });
    pages.push(...r.results.filter(p => !p.archived && !p.in_trash));
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return { schema, pages, blocks: null };
}

const plain = rt => (rt || []).map(t => t.plain_text).join("").trim();

/** 讀取頁面內文當作心得筆記（段落、標題、條列、引言） */
async function fetchNote(page, mockBlocks) {
  const results = mockBlocks
    ? mockBlocks[page.id] || []
    : (await notion("GET", `blocks/${page.id}/children?page_size=100`)).results;
  const paras = [];
  for (const b of results) {
    const v = b[b.type];
    if (!v?.rich_text) continue;
    const text = plain(v.rich_text);
    if (!text) continue;
    paras.push(b.type.includes("list_item") ? `・${text}` : text);
  }
  return paras.join("\n\n");
}

/* ───────────── 欄位讀取 ───────────── */
function readProp(p) {
  if (!p) return null;
  switch (p.type) {
    case "title": return plain(p.title);
    case "rich_text": return plain(p.rich_text);
    case "select": return p.select?.name ?? null;
    case "multi_select": return p.multi_select.map(o => o.name);
    case "status": return p.status?.name ?? null;
    case "number": return p.number;
    case "date": return p.date ? { start: p.date.start, end: p.date.end } : null;
    case "files": return p.files.map(f => (f.type === "external" ? f.external.url : f.file.url));
    case "url": return p.url;
    case "people": return p.people.map(x => x.name).filter(Boolean);
    case "checkbox": return p.checkbox;
    case "formula": return p.formula?.[p.formula.type] ?? null;
    default: return null;
  }
}

const norm = s => s.replace(/\s+/g, "").toLowerCase();
/** 依候選名稱找欄位：先完全相符，再找開頭相符（例如「分類 / 系列」對到「分類」） */
function findPropName(props, candidates = []) {
  const names = Object.keys(props);
  for (const c of candidates) {
    const hit = names.find(n => norm(n) === norm(c));
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = names.find(n => norm(n).startsWith(norm(c)));
    if (hit) return hit;
  }
  return null;
}
const catFields = (key, cat) => {
  const f = config.fields[key];
  return Array.isArray(f) ? f : f?.[cat] || [];
};

const asText = v => (Array.isArray(v) ? v.join("、") : v == null ? "" : typeof v === "object" ? "" : String(v)).trim();
const asNumber = v => {
  if (typeof v === "number") return v;
  const m = asText(v).match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const asList = v => (Array.isArray(v) ? v : asText(v).split(/\s*[\/、,，|｜]\s*/)).map(s => s.trim()).filter(Boolean);
const asRating = v => {
  if (typeof v === "number") return Math.max(0, Math.min(5, Math.round(v)));
  const t = asText(v);
  const stars = (t.match(/[★⭐]/g) || []).length;
  return stars || asNumber(t) || null;
};
const asDate = v => (v && typeof v === "object" && !Array.isArray(v) ? v.start?.slice(0, 10) : asText(v).slice(0, 10)) || null;

/** 狀態：依 Notion 內建分組（To-do／In progress／Complete）判斷，改選項名稱也不受影響 */
function statusResolver(schema) {
  const name = Object.keys(schema.properties).find(n => schema.properties[n].type === "status")
    || findPropName(schema.properties, ["狀態", "Status"]);
  const def = name && schema.properties[name];
  const groupOf = {};
  for (const g of def?.status?.groups || []) for (const id of g.option_ids) groupOf[id] = g.name;
  const classify = s => {
    if (!s) return "unread";
    if (/complete|done|完成|已讀|已看|看完|讀完/i.test(s)) return "read";
    if (/progress|進行|閱讀中|觀看中|reading|watching/i.test(s)) return "reading";
    return "unread";
  };
  return page => {
    const p = page.properties[name];
    if (!p) return "unread";
    if (p.type === "status") return classify(groupOf[p.status?.id] || p.status?.name);
    return classify(asText(readProp(p)));
  };
}

/** 「怪物 (Beyond Evil, 韓劇備選)」→ 主標題「怪物」、副標「Beyond Evil, 韓劇備選」、查詢用「Beyond Evil」 */
function parseTitle(raw) {
  const m = raw.match(/^(.+?)\s*[（(]([^()（）]+)[)）]\s*$/);
  // 括號裡沒有外文（例如「謊言(再一個謊言)」）就視為書名的一部分，不拆
  if (!m || !/[A-Za-z]/.test(m[2])) return { title: raw.trim(), sub: "", alt: "" };
  const alt = m[2].split(/[,，]/)[0].replace(/系列|劇場版|韓劇|日劇|美劇|備選/g, "").trim();
  return { title: m[1].trim(), sub: m[2].trim(), alt: /[A-Za-z]/.test(alt) ? alt : "" };
}

/* ───────────── 封面查詢 ───────────── */
async function getJSON(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 && attempt < 2) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
    return res.json();
  }
}

async function tmdb(kind, it) {
  if (!TMDB_TOKEN) return null;
  const bearer = TMDB_TOKEN.startsWith("eyJ");
  const auth = bearer ? { Authorization: `Bearer ${TMDB_TOKEN}` } : {};
  const key = bearer ? "" : `&api_key=${TMDB_TOKEN}`;
  for (const q of [it.alt, it.title].filter(Boolean)) {
    const s = await getJSON(`https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(q)}&language=zh-TW&include_adult=false${key}`, auth);
    const hit = s.results?.[0];
    if (!hit) continue;
    const d = await getJSON(`https://api.themoviedb.org/3/${kind}/${hit.id}?language=zh-TW${key}`, auth);
    const date = d.release_date || d.first_air_date || "";
    return {
      cover: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
      year: date ? Number(date.slice(0, 4)) : null,
      mins: d.runtime || null,
      eps: d.number_of_episodes || null,
      seasons: d.number_of_seasons || null,
      intro: d.overview || "",
    };
  }
  return null;
}

let googleBlocked = false;
async function googleBooks(it) {
  if (googleBlocked) return undefined; // 本次同步已被限流：不再查，留待下次
  const key = GOOGLE_BOOKS_KEY ? `&key=${GOOGLE_BOOKS_KEY}` : "";
  try {
    return await googleBooksQuery(it, key);
  } catch (e) {
    if (e.message.startsWith("429")) {
      googleBlocked = true;
      warn(`Google Books 拒絕查詢（次數限制）${GOOGLE_BOOKS_KEY ? "" : "，建議在 .env 加上 GOOGLE_BOOKS_KEY"}；本次略過其餘書籍封面，下次同步再試`);
      return undefined;
    }
    throw e;
  }
}
/* 比對用：去掉空白與標點，英文轉小寫 */
const bookKey = s => (s || "").toLowerCase().replace(/[\s·・．.。,，、:：;；!！?？'"“”‘’「」『』《》〈〉()（）\[\]【】\-—–_~～]/g, "");
/** 作者名的各種寫法：「詹姆斯·克利爾 (James Clear)」→ 中譯全名、原文全名、姓氏 */
function authorVariants(by) {
  const first = (by || "").split(/[、,，]/)[0].trim();
  if (!first) return [];
  const inParen = first.match(/[（(]([^()（）]+)[)）]/)?.[1] || "";
  const outside = first.replace(/\s*[（(][^()（）]*[)）]\s*/g, "").trim();
  const parts = [outside, inParen, outside.split(/[·・.．\s]/).pop(), inParen.split(/\s+/).pop()];
  return [...new Set(parts.map(bookKey).filter(p => p.length >= 2))];
}
const SPINOFF = /workbook|練習本|筆記本|導讀|解析|漫畫|手帳|精選|summary|有聲/i;

/** 自己的書名可比對的寫法：「謊言(再一個謊言)」→ 全名、括號外、括號內 */
function wantedTitles(title) {
  const inParen = title.match(/[（(]([^()（）]+)[)）]/)?.[1] || "";
  const outside = title.replace(/\s*[（(][^()（）]*[)）]\s*/g, "");
  return [...new Set([title, outside, inParen].map(bookKey).filter(Boolean))];
}
/** Google 書名可比對的寫法：去掉【系列】前綴、結尾（版本說明），並拆開「假面飯店：假面之夜」的冒號段落 */
function foundTitles(title = "") {
  const base = title.replace(/^\s*【[^】]*】\s*/, "").replace(/\s*[（(][^()（）]*[)）]\s*$/, "");
  return [...new Set([title, base, ...base.split(/[：:]/)].map(bookKey).filter(Boolean))];
}
const hasLatinOnly = names => names.length && names.every(n => /^[a-z\s.'-]+$/i.test(n));

/**
 * 只接受「書名相符」的結果，避免抓到別本書：
 *   書名完全相同 → 最優先；開頭相同且不是 Workbook／導讀等衍生書 → 次之；其他一律不要。
 *   有作者時作者也要對得上；只有在書名完全相同、但 Google 只給羅馬拼音作者（如 Higashino Keigo）時放行。
 */
function pickVolume(items, it) {
  const wants = wantedTitles(it.title);
  const authors = authorVariants(it.by);
  let best = null, bestScore = 0;
  for (const item of items || []) {
    const v = item.volumeInfo || {};
    if (!v.imageLinks) continue; // 要的是封面：沒有圖的版本直接略過
    const gots = foundTitles(v.title);
    const exact = gots.some(g => wants.includes(g));
    const prefix = !exact && gots.some(g => wants.some(w => g.startsWith(w))) && !SPINOFF.test(v.title + (v.subtitle || ""));
    let score = exact ? 3 : prefix ? 2 : 0;
    if (!score) continue;
    if (authors.length) {
      const theirs = (v.authors || []).map(bookKey);
      const matched = theirs.some(a => authors.some(w => a.includes(w) || w.includes(a)));
      const romanizedOnly = exact && /[^\u0000-ɏ]/.test(it.by) && hasLatinOnly(v.authors || []);
      if (!matched && !romanizedOnly) continue;
    }
    if (/^zh/.test(v.language || "")) score += 0.25;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

async function googleBooksQuery(it, key) {
  const author = it.by.split(/[、,，]/)[0].replace(/\s*[（(][^()（）]*[)）]\s*/g, "").trim();
  const queries = [`intitle:${it.title}${author ? `+inauthor:${author}` : ""}`, `intitle:${it.title}`];
  for (const q of queries) {
    const s = await getJSON(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10${key}`);
    const v = pickVolume(s.items, it);
    if (!v) continue;
    const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail;
    return {
      cover: img ? img.replace(/^http:/, "https:").replace("&edge=curl", "") : null,
      // 年份是版次年份、不是原著出版年，所以不採用；頁數太少多半是電子書試閱頁數，也不採用
      pages: v.pageCount >= 120 ? v.pageCount : null,
      intro: v.description ? v.description.slice(0, 180) : "",
    };
  }
  return null;
}

async function lookup(it) {
  if (!LOOKUP) return null;
  try {
    if (it.cat === "movie") return await tmdb("movie", it);
    if (it.cat === "drama") return await tmdb("tv", it);
    const r = await googleBooks(it);
    return r;
  } catch (e) {
    // 回傳 undefined：不寫入快取，下次同步再試（查無結果才會快取成 null）
    warn(`查詢「${it.title}」失敗：${e.message}（下次同步會再試）`);
    return undefined;
  }
}

/** 下載封面、縮成 320px 寬存檔，並取主色當書脊顏色 */
async function saveCover(url, id) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載封面 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = sharp(buf).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 78 });
  const out = await img.toBuffer();
  await fs.writeFile(path.join(COVER_DIR, `${id}.jpg`), out);
  const { dominant } = await sharp(out).stats();
  const hex = "#" + [dominant.r, dominant.g, dominant.b].map(n => n.toString(16).padStart(2, "0")).join("");
  return { file: `covers/${id}.jpg`, color: hex.toUpperCase() };
}

const FALLBACK = ["#2F4A5C", "#8A1F24", "#5E7B6A", "#C47A2C", "#3B3A6B", "#7B5A3A", "#B3262B", "#3E6C8A", "#6F7E5B", "#D98C5F", "#2C2A4A", "#A8742F"];
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/* ───────────── 主流程 ───────────── */
async function main() {
  if (!MOCK && !NOTION_TOKEN && process.env.CI) {
    // GitHub Actions 尚未設定 NOTION_TOKEN：略過，不讓排程失敗
    warn("尚未在 GitHub Secrets 設定 NOTION_TOKEN，本次略過同步");
    return;
  }
  if (!MOCK && !NOTION_TOKEN) {
    console.error("找不到 NOTION_TOKEN。請在專案根目錄建立 .env，內容：NOTION_TOKEN=你的密鑰（或加上 --mock 用模擬資料測試）");
    process.exit(1);
  }
  await fs.mkdir(COVER_DIR, { recursive: true });
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const cache = existsSync(CACHE_FILE) ? JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) : { pages: {}, lookups: {} };

  // 上一次的輸出：查詢失敗時拿來保留封面
  const prevPath = path.join(SITE, "data.json");
  const prevById = existsSync(prevPath)
    ? Object.fromEntries((JSON.parse(await fs.readFile(prevPath, "utf8")).items || []).map(i => [i.id, i]))
    : {};

  const items = [];
  for (const db of config.databases) {
    if (!MOCK && !db.id) { warn(`「${db.name}」還沒填資料庫 ID，略過`); continue; }
    log(`📚 讀取「${db.name}」…`);
    const { schema, pages, blocks } = await fetchDatabase(db);
    const props = schema.properties;
    const status = statusResolver(schema);
    const titleName = Object.keys(props).find(n => props[n].type === "title");
    const F = key => findPropName(props, catFields(key, db.category));
    const fieldNames = Object.fromEntries(
      ["by", "credit", "tags", "intro", "series", "rating", "dates", "start", "end", "length", "seasons", "progress", "year", "cover", "note"].map(k => [k, F(k)])
    );
    log("   對應欄位：", Object.entries(fieldNames).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("，") || "（無）");

    for (const page of pages) {
      const get = key => (fieldNames[key] ? readProp(page.properties[fieldNames[key]]) : null);
      const rawTitle = readProp(page.properties[titleName]) || "";
      if (!rawTitle) continue;
      const t = parseTitle(rawTitle);
      const it = {
        id: page.id.replace(/-/g, ""),
        cat: db.category,
        title: t.title,
        sub: t.sub,
        alt: t.alt,
        by: asText(get("by")),
        credit: asText(get("credit")),
        series: asText(get("series")),
        status: status(page),
        tags: asList(get("tags")),
        intro: asText(get("intro")),
        rating: asRating(get("rating")),
        year: asNumber(get("year")),
        prog: asNumber(get("progress")),
        seasons: asNumber(get("seasons")),
        note: asText(get("note")),
      };
      // 日期：日期範圍欄位，或分開的開始／完成欄位
      const range = get("dates");
      it.start = asDate(range) || asDate(get("start"));
      it.end = (range && typeof range === "object" ? range.end?.slice(0, 10) : null) || asDate(get("end"));
      if (it.cat === "movie" && it.status === "read" && !it.end) it.end = it.start;
      const len = asNumber(get("length"));
      if (len) it[{ tool: "pages", novel: "pages", movie: "mins", drama: "eps" }[it.cat]] = len;

      // 心得：頁面內文（內文有改才重新抓）
      const cached = cache.pages[it.id];
      const fresh = cached && cached.edited === page.last_edited_time;
      if (!it.note) it.note = fresh ? cached.note : await fetchNote(page, blocks).catch(e => (warn(e.message), ""));

      // 自動查詢：補封面、年份、長度、簡介（Notion 有填的優先）
      const lkKey = `${it.cat}:${rawTitle}:${it.by}`;
      let info = cache.lookups[lkKey];
      if (info === undefined && LOOKUP) {
        info = await lookup(it);
        if (info !== undefined) cache.lookups[lkKey] = info;
      }
      if (info) {
        it.year ??= info.year;
        if (!it.intro && info.intro) it.intro = info.intro;
        for (const k of ["pages", "mins", "eps", "seasons"]) if (!it[k] && info[k]) it[k] = info[k];
      }

      // 封面：Notion「封面」欄位 → 頁面封面 → 自動查詢結果
      const notionCover = get("cover")?.[0] || (page.cover ? page.cover[page.cover.type]?.url : null);
      const coverUrl = notionCover || info?.cover;
      // Notion 上傳的圖片網址會過期，所以用「頁面修改時間」判斷是否換過封面
      const coverSrc = notionCover ? `notion:${page.last_edited_time}` : info?.cover || null;
      if (coverUrl && cached?.coverSrc === coverSrc && cached.cover && existsSync(path.join(SITE, cached.cover))) {
        it.cover = cached.cover; it.color = cached.color;
      } else if (coverUrl) {
        try {
          const saved = await saveCover(coverUrl, it.id);
          it.cover = saved.file; it.color = saved.color;
        } catch (e) { warn(`「${it.title}」封面：${e.message}`); }
      }
      // 查詢失敗（被限流、雲端沒有金鑰）時沿用上次的封面與資料，不讓已經有的封面消失
      const prevItem = prevById[it.id];
      if (info === undefined && prevItem) {
        if (!it.cover && prevItem.cover && existsSync(path.join(SITE, prevItem.cover))) { it.cover = prevItem.cover; it.color = prevItem.color; }
        for (const k of ["pages", "mins", "eps", "seasons", "year"]) if (!it[k] && prevItem[k]) it[k] = prevItem[k];
      }
      it.color ||= FALLBACK[hash(it.title) % FALLBACK.length];

      cache.pages[it.id] = {
        edited: page.last_edited_time, note: it.note, cover: it.cover, color: it.color, coverSrc,
      };
      delete it.alt;
      for (const k of Object.keys(it)) if (it[k] === null || it[k] === "" || (Array.isArray(it[k]) && !it[k].length)) delete it[k];
      items.push(it);
    }
    log(`   ✓ ${pages.length} 筆`);
  }

  // 內容沒變就沿用上次的更新時間，避免每次排程都產生一筆沒有意義的提交
  const dataFile = path.join(SITE, "data.json");
  const prev = existsSync(dataFile) ? JSON.parse(await fs.readFile(dataFile, "utf8")) : null;
  const same = prev && JSON.stringify(prev.items) === JSON.stringify(items);
  const generatedAt = same ? prev.generatedAt : new Date().toISOString();
  await fs.writeFile(dataFile, JSON.stringify({ generatedAt, items }, null, 1));
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache));
  const count = s => items.filter(i => i.status === s).length;
  log(`\n完成：${items.length} 件收藏（已讀 ${count("read")}、進行中 ${count("reading")}、未讀 ${count("unread")}）→ reading/data.json`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
