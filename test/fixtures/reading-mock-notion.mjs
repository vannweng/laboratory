/**
 * 模擬 Notion API 回傳格式，用來在沒有密鑰時測試同步流程（npm run sync:mock）。
 * 劇清單、小說的欄位與內容取自使用者 Notion 截圖；電影、工具書為示意資料。
 */
const rt = s => [{ type: "text", plain_text: s, text: { content: s } }];
const P = {
  title: s => ({ type: "title", title: rt(s) }),
  text: s => ({ type: "rich_text", rich_text: s ? rt(s) : [] }),
  select: s => ({ type: "select", select: s ? { name: s } : null }),
  multi: arr => ({ type: "multi_select", multi_select: arr.map(name => ({ name })) }),
  number: n => ({ type: "number", number: n ?? null }),
  date: (start, end = null) => ({ type: "date", date: start ? { start, end } : null }),
  status: key => ({ type: "status", status: { id: key, name: { todo: "未開始", doing: "進行中", done: "已完成" }[key] } }),
};
const statusSchema = {
  type: "status",
  status: {
    options: [{ id: "todo", name: "未開始" }, { id: "doing", name: "進行中" }, { id: "done", name: "已完成" }],
    groups: [
      { name: "To-do", option_ids: ["todo"] },
      { name: "In progress", option_ids: ["doing"] },
      { name: "Complete", option_ids: ["done"] },
    ],
  },
};
let n = 0;
const page = properties => ({ id: `mock-${String(++n).padStart(4, "0")}`, last_edited_time: "2026-11-22T00:00:00.000Z", cover: null, properties });
const para = s => ({ type: "paragraph", paragraph: { rich_text: rt(s) } });

/* ── 劇清單（截圖欄位：狀態、片名、類別、主演、導演/主創、特色亮點） ── */
const dramaSchema = {
  properties: {
    狀態: statusSchema, 片名: { type: "title" }, 類別: { type: "rich_text" }, 主演: { type: "rich_text" },
    "導演/主創": { type: "rich_text" }, 特色亮點: { type: "rich_text" },
  },
};
const D = (s, title, cat, cast, dir, note) => page({ 狀態: P.status(s), 片名: P.title(title), 類別: P.text(cat), 主演: P.text(cast), "導演/主創": P.text(dir), 特色亮點: P.text(note) });
const dramaPages = [
  D("doing", "絕命毒師", "犯罪 / 劇情 / 驚悚", "布萊恩·克萊斯頓、亞倫·保羅", "文斯·吉利根", "高中化學老師一步步墮落成為傳奇毒梟。"),
  D("todo", "怪物 (Beyond Evil, 韓劇備選)", "心理 / 犯罪 / 懸疑", "申河均、呂珍九", "申娜妍", "鄉村連環殺人疑雲、全員嫌疑犯。"),
  D("todo", "黑鏡 (Black Mirror)", "科幻 / 懸疑 / 諷刺", "獨立單元劇（每集不同主演）", "查理·布魯克", "近未來科技對人性、道德體系與社會的衝擊。"),
  D("todo", "以吾之名 (My Name)", "犯罪 / 動作 / 復仇", "韓韶禧、朴喜洵、安普賢", "金鎮民", "女主隱姓埋名臥底警察追查殺父仇人。"),
  D("todo", "第二聲鈴響 (The Innocent)", "懸疑 / 犯罪 / 迷你劇", "馬里奧·卡薩斯、奧拉·加里多", "奧瑞歐·保羅", "《佈局》導演操刀、多視角重疊。"),
  D("todo", "大劍 (Claymore)", "動畫 / 奇幻 / 暗黑熱血", "桑島法子、高山南 (配音)", "田中洋之", "半人半妖女戰士悲壯命運、冷酷暗黑。"),
  D("todo", "圈套 (TRICK 系列)", "懸疑 / 推理 / 喜劇", "仲間由紀惠、阿部寬", "堤幸彥", "魔術師與怪咖物理教授搭檔破除偽超能力。"),
  D("todo", "Modern Family", "學英文", "", "", ""),
];
dramaPages[0].properties.狀態 = P.status("doing");

/* ── 小說閱讀清單（截圖欄位：狀態、書名 1、分類 / 系列、核心主題 / 標籤、作者、特色與備註） ── */
const novelSchema = {
  properties: {
    狀態: statusSchema, "書名 1": { type: "title" }, "分類 / 系列": { type: "select" },
    "核心主題 / 標籤": { type: "rich_text" }, 作者: { type: "multi_select" }, 特色與備註: { type: "rich_text" },
  },
};
const N = (s, title, series, tags, author, note) => page({ 狀態: P.status(s), "書名 1": P.title(title), "分類 / 系列": P.select(series), "核心主題 / 標籤": P.text(tags), 作者: P.multi([author]), 特色與備註: P.text(note) });
const novelPages = [
  N("todo", "謊言(再一個謊言)", "加賀恭一郎系列", "心理攻防、謊言矛盾、善惡邊界", "東野圭吾", "加賀系列唯一短篇集（亦見新版《湖畔的謊言》）"),
  N("doing", "祈念之樹", "單本獨立作", "神楠祈念、家族傳承、思念寄託、和解", "東野圭吾", "《解憂雜貨店》姊妹治癒作"),
  N("todo", "時生", "單本獨立作", "穿越時空、父子羈絆、生命的奇蹟", "東野圭吾", "溫暖療癒科幻作"),
];

/* ── 電影（示意） ── */
const movieSchema = {
  properties: { 狀態: statusSchema, 片名: { type: "title" }, 類別: { type: "rich_text" }, 導演: { type: "rich_text" }, 主演: { type: "rich_text" }, 評分: { type: "select" }, 觀看日期: { type: "date" }, 片長: { type: "number" } },
};
const moviePages = [
  page({ 狀態: P.status("done"), 片名: P.title("一一 (Yi Yi)"), 類別: P.text("劇情 / 家庭"), 導演: P.text("楊德昌"), 主演: P.text("吳念真"), 評分: P.select("★★★★★"), 觀看日期: P.date("2026-02-14"), 片長: P.number(173) }),
  page({ 狀態: P.status("doing"), 片名: P.title("我的完美日常 (Perfect Days)"), 類別: P.text("劇情"), 導演: P.text("文·溫德斯"), 主演: P.text("役所廣司"), 評分: P.select(null), 觀看日期: P.date("2026-11-20"), 片長: P.number(124) }),
];
moviePages[1].properties.進度 = P.number(62);
movieSchema.properties.進度 = { type: "number" };

/* ── 工具書（示意） ── */
const toolSchema = {
  properties: { 狀態: statusSchema, 書名: { type: "title" }, 作者: { type: "rich_text" }, 標籤: { type: "multi_select" }, 評分: { type: "number" }, 閱讀日期: { type: "date" }, 頁數: { type: "number" }, 進度: { type: "number" } },
};
const toolPages = [
  page({ 狀態: P.status("done"), 書名: P.title("原子習慣"), 作者: P.text("James Clear"), 標籤: P.multi(["習慣", "自我管理"]), 評分: P.number(5), 閱讀日期: P.date("2026-01-04", "2026-01-29"), 頁數: P.number(320) }),
  page({ 狀態: P.status("doing"), 書名: P.title("卡片盒筆記"), 作者: P.text("Sönke Ahrens"), 標籤: P.multi(["筆記"]), 閱讀日期: P.date("2026-11-08"), 頁數: P.number(240), 進度: P.number(88) }),
  page({ 狀態: P.status("todo"), 書名: P.title("非暴力溝通"), 作者: P.text("Marshall B. Rosenberg"), 標籤: P.multi(["溝通"]), 頁數: P.number(288) }),
];

export const mockDatabases = {
  drama: { schema: dramaSchema, pages: dramaPages, blocks: { [dramaPages[0].id]: [para("第三季開始，越看越不安。")] } },
  novel: { schema: novelSchema, pages: novelPages, blocks: { [novelPages[1].id]: [para("讀到一半，節奏很溫柔。"), { type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("千舟阿姨這個角色很好") } }] } },
  movie: { schema: movieSchema, pages: moviePages, blocks: { [moviePages[0].id]: [para("洋洋拍別人後腦勺那段，看幾次都喜歡。")] } },
  tool: { schema: toolSchema, pages: toolPages, blocks: { [toolPages[0].id]: [para("最受用的是「習慣堆疊」。")] } },
};
