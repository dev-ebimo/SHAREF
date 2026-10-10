// Downloads: a personal library of every file this account has downloaded.
// Re-downloading is always free, so it uses its own endpoint that can never
// charge the wallet (GET /downloads/:resourceId/file), instead of the paid
// /wallet/charge flow.
document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) return; // dashboard.js already ran requireAuth()

    const PAGE = 20;
    let items = [];
    let shown = PAGE;

    const $ = (id) => document.getElementById(id);
    const list = $('dlList'), empty = $('emptyState'), moreWrap = $('dlMoreWrap');
    const naira = (n) => '\u20A6' + Math.round(Number(n) || 0).toLocaleString('en-NG');
    const toast = (m) => (window.SharefWallet ? window.SharefWallet.showToast(m) : alert(m));

    function fmtDay(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
    function monthKey(iso) { return new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }

    function load() {
        list.innerHTML = '<div class="skeleton-card"><div class="skeleton-line short"></div><div class="skeleton-line tall long"></div></div>'.repeat(3);
        authFetch(API_BASE + '/downloads')
            .then((r) => r.json())
            .then((d) => {
                if (!d.success) throw new Error('failed');
                items = d.downloads || [];
                renderStats();
                render();
            })
            .catch((err) => {
                console.error('Could not load downloads:', err);
                list.innerHTML = '<p class="dl-error">Could not load your downloads. Please refresh the page.</p>';
            });
    }

    function renderStats() {
        $('dlStats').classList.toggle('hidden', items.length === 0);
        const now = new Date();
        $('dlCount').textContent = items.length;
        $('dlMonth').textContent = items.filter((i) => { const d = new Date(i.downloadedAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
        $('dlSpent').textContent = naira(items.reduce((s, i) => s + (Number(i.pricePaid) || 0), 0));
    }

    function filtered() {
        const q = $('dlSearch').value.toLowerCase().trim(), type = $('dlType').value, sort = $('dlSort').value;
        const out = items.filter((i) => (!q || (i.title || '').toLowerCase().includes(q) || (i.course || '').toLowerCase().includes(q)) && (type === 'all' || i.type === type));
        out.sort((a, b) => sort === 'course' ? String(a.course).localeCompare(String(b.course))
            : sort === 'oldest' ? new Date(a.downloadedAt) - new Date(b.downloadedAt)
            : new Date(b.downloadedAt) - new Date(a.downloadedAt));
        return { out, grouped: sort !== 'course' };
    }

    function render() {
        const { out, grouped } = filtered();
        list.innerHTML = '';
        moreWrap.classList.add('hidden');
        if (out.length === 0) {
            const none = items.length > 0;
            $('emptyTitle').textContent = none ? 'No downloads match' : 'No downloads yet';
            $('emptyText').textContent = none ? 'Try a different search or type.' : 'Files you download will be stored here so you can get them again for free.';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');
        const page = out.slice(0, shown);
        let lastGroup = null;
        page.forEach((item) => {
            if (grouped) {
                const g = monthKey(item.downloadedAt);
                if (g !== lastGroup) { const h = document.createElement('h2'); h.className = 'dl-group'; h.textContent = g; list.appendChild(h); lastGroup = g; }
            }
            list.appendChild(row(item));
        });
        if (out.length > shown) moreWrap.classList.remove('hidden');
    }

    function row(item) {
        const el = document.createElement('div');
        el.className = 'dl-row' + (item.available === false ? ' is-gone' : '');
        const ext = escapeHtml((item.fileExtension || 'file').replace('.', '').slice(0, 4).toUpperCase());
        const meta = [item.course, item.type, item.level, item.size].filter(Boolean).map(escapeHtml).join(' \u2022 ');
        el.innerHTML =
            '<div class="dl-ext" aria-hidden="true">' + ext + '</div>' +
            '<div class="dl-main"><h3 class="dl-title">' + escapeHtml(item.title) + '</h3><p class="dl-meta">' + meta + '</p></div>' +
            '<div class="dl-when"><span>' + fmtDay(item.downloadedAt) + '</span><span class="dl-paid">' + (item.pricePaid ? 'Paid ' + naira(item.pricePaid) : 'Free') + '</span></div>' +
            (item.available === false
                ? '<span class="dl-unavail">No longer available</span>'
                : '<button type="button" class="dl-btn">Download again</button>');
        const btn = el.querySelector('.dl-btn');
        if (btn) btn.addEventListener('click', () => redownload(item, btn));
        return el;
    }

    function redownload(item, btn) {
        btn.disabled = true; const label = btn.textContent; btn.textContent = 'Preparing\u2026';
        authFetch(API_BASE + '/downloads/' + encodeURIComponent(item.id) + '/file')
            .then((r) => r.json())
            .then((d) => {
                if (!d.success || !d.fileUrl) { toast(d.message || 'This file could not be downloaded right now.'); return; }
                if (!window.open(d.fileUrl, '_blank')) window.location.href = d.fileUrl;
                toast('\u201C' + item.title + '\u201D download started. No charge.');
            })
            .catch(() => toast('Network error \u2014 could not start the download.'))
            .then(() => { btn.disabled = false; btn.textContent = label; });
    }

    ['dlSearch', 'dlType', 'dlSort'].forEach((id) => $(id).addEventListener(id === 'dlSearch' ? 'input' : 'change', () => { shown = PAGE; render(); }));
    $('dlMoreBtn').addEventListener('click', () => { shown += PAGE; render(); });
    load();
});
