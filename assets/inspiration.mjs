const status = document.querySelector('#updatesStatus');
const summary = document.querySelector('#trackingSummary');
const updateGroups = [...document.querySelectorAll('[data-update-category]')];
const categoryByUsername = new Map(
  [...document.querySelectorAll('[data-category]')].flatMap((section) =>
    [...section.querySelectorAll('.account-name')].map((name) => [name.textContent.trim(), section.dataset.category]),
  ),
);

for (const list of document.querySelectorAll('.account-list')) {
  const entries = [...list.children];
  for (const entry of entries) {
    const link = entry.querySelector('a');
    const username = entry.querySelector('.account-name').textContent.trim();
    link.setAttribute('aria-label', `開啟 @${username} 的 Instagram`);
    link.title = `@${username}`;
    const fallback = document.createElement('span');
    fallback.className = 'avatar-fallback';
    fallback.textContent = username.replace(/^_+/, '').slice(0, 1).toUpperCase();
    fallback.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.alt = '';
    image.width = 50;
    image.height = 50;
    image.addEventListener('error', () => image.remove(), { once: true });
    image.src = `./avatars/${encodeURIComponent(username)}.jpg`;
    link.prepend(fallback, image);
  }
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function createUpdateRow(item) {
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
}

function renderUpdates(items) {
  const grouped = new Map(updateGroups.map((group) => [group.dataset.updateCategory, []]));
  items.forEach((item) => {
    const category = categoryByUsername.get(item.username) || 'ai';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  });
  updateGroups.forEach((group) => {
    const list = group.querySelector('.updates-list');
    const empty = group.querySelector('.updates-empty');
    const rows = (grouped.get(group.dataset.updateCategory) || []).map(createUpdateRow);
    list.replaceChildren(...rows);
    empty.hidden = rows.length > 0;
  });
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
    summary.textContent = `Instagram · ${categoryByUsername.size} 位追蹤中`;
    status.textContent = data.last_checked_at ? `最近同步 · ${formatTime(data.last_checked_at)} · 每 12 小時更新` : '等待首次雲端同步';
    updateGroups.forEach((group) => {
      const empty = group.querySelector('.updates-empty');
      if (!group.querySelector('.updates-list').children.length) {
        empty.textContent = data.last_checked_at ? '最近 24 小時沒有新消息。' : '完成首次同步後，這裡會顯示最近 24 小時的新消息。';
      }
    });
  } catch {
    status.textContent = '暫時無法讀取更新資料。';
    updateGroups.forEach((group) => {
      group.querySelector('.updates-list').replaceChildren();
      const empty = group.querySelector('.updates-empty');
      empty.hidden = false;
      empty.textContent = '請稍後重新整理頁面。';
    });
  }
}

refresh();
window.setInterval(refresh, 60_000);
