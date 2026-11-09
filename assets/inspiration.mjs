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
    meta.textContent = `${item.kind === 'reel' ? 'Reel' : '貼文'} · ${formatTime(item.posted_at)} · 開啟 Instagram ↗`;
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
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const response = await fetch(local ? '../api/kol/recent' : './feed.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    const now = Date.now();
    renderUpdates((data.items ?? []).filter((item) => {
      const published = Date.parse(item.posted_at);
      return published <= now && published >= now - 24 * 60 * 60 * 1000;
    }));
    summary.textContent = `Instagram · ${data.tracked_count ?? 0} 位追蹤中`;
    status.textContent = data.last_checked_at ? `最近同步 · ${formatTime(data.last_checked_at)} · 每 12 小時更新` : '等待首次雲端同步';
    empty.textContent = data.last_checked_at ? '最近 24 小時沒有新貼文。' : '完成首次同步後，這裡會顯示最近 24 小時的新消息。';
  } catch {
    status.textContent = '暫時無法讀取更新資料。';
    empty.hidden = false;
    empty.textContent = '請稍後重新整理頁面。';
  }
}

refresh();
window.setInterval(refresh, 60_000);
