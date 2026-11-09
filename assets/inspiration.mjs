const list = document.querySelector('#updatesList');
const empty = document.querySelector('#updatesEmpty');
const status = document.querySelector('#updatesStatus');
const summary = document.querySelector('#trackingSummary');

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function renderUpdates(items) {
  const rows = items.map((item) => {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = `https://www.instagram.com/p/${encodeURIComponent(item.shortcode)}/`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    const title = document.createElement('strong');
    title.textContent = `@${item.username}`;
    const meta = document.createElement('span');
    meta.className = 'update-meta';
    meta.textContent = `${item.kind === 'reel' ? 'Reel' : '貼文'} · ${formatTime(item.detected_at)} · 開啟 Instagram ↗`;
    const caption = document.createElement('span');
    caption.className = 'update-caption';
    caption.textContent = item.caption?.trim() || '未提供文字摘要。';
    link.append(title, meta, caption);
    row.append(link);
    return row;
  });
  list.replaceChildren(...rows);
  empty.hidden = items.length > 0;
}

async function refresh() {
  try {
    const response = await fetch('../api/kol/recent', { cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    renderUpdates(data.items ?? []);
    summary.textContent = `Instagram · ${data.tracked_count ?? 0} 位追蹤中`;
    status.textContent = data.last_checked_at ? `最近同步 · ${formatTime(data.last_checked_at)}` : '等待第一次同步';
  } catch {
    status.textContent = '本機追蹤資料尚未連線。';
    empty.hidden = false;
    empty.textContent = '請從本機資料預覽開啟此頁，才能顯示新的貼文。';
  }
}

refresh();
window.setInterval(refresh, 60_000);
