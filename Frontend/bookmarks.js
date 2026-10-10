// Wishlist: resources the student wants to get. Same endpoints as before
// (GET /bookmarks, POST /bookmarks/:id toggles), now with prices, a wallet
// summary, "owned" awareness and undo on remove. Purchases still go through
// the existing paid flow, so the backend remains the authority on price and
// ownership.
document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) return; // dashboard.js already ran requireAuth()

    let wishlist = [];
    let balance = null;

    const $ = (id) => document.getElementById(id);
    const grid = $('bookmarksGrid'), empty = $('emptyState'), summary = $('wlSummary');
    const W = () => window.SharefWallet;
    const naira = (n) => (W() ? W().formatNaira(n) : '\u20A6' + Math.round(n).toLocaleString('en-NG'));
    const costOf = (item) => (W() ? W().calculateCost(Number(item.pages) || 1) : 0);
    const HEART = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>';

    // ---- snackbar with Undo ------------------------------------------------
    const snack = document.createElement('div');
    snack.className = 'wl-snack'; snack.setAttribute('role', 'status');
    document.body.appendChild(snack);
    let snackTimer = null;
    function showSnack(message, undo) {
        snack.innerHTML = '<span></span>' + (undo ? '<button type="button">Undo</button>' : '');
        snack.firstChild.textContent = message;
        if (undo) snack.querySelector('button').onclick = () => { snack.classList.remove('is-visible'); undo(); };
        snack.classList.add('is-visible');
        clearTimeout(snackTimer);
        snackTimer = setTimeout(() => snack.classList.remove('is-visible'), 5000);
    }

    // ---- load ----------------------------------------------------------------
    function load() {
        grid.innerHTML = '<div class="skeleton-card"><div class="skeleton-line short"></div><div class="skeleton-line tall long"></div><div class="skeleton-line medium"></div></div>'.repeat(6);
        empty.classList.add('hidden');
        authFetch(API_BASE + '/bookmarks')
            .then((r) => r.json())
            .then((d) => {
                if (!d.success) { grid.innerHTML = ''; return; }
                wishlist = (d.resources || []).map((r, i) => Object.assign({ _order: i }, r));
                refreshBalance();
                render();
            })
            .catch((err) => {
                console.error('Could not load wishlist:', err);
                grid.innerHTML = '<p class="bookmarks-error">Could not load your wishlist. Please refresh the page.</p>';
            });
    }

    function refreshBalance() {
        if (!W() || !W().refreshBalance) return Promise.resolve();
        return W().refreshBalance().then((b) => { balance = typeof b === 'number' ? b : balance; renderSummary(); render(); });
    }

    // ---- summary -------------------------------------------------------------
    function renderSummary() {
        const wanted = wishlist.filter((i) => !i.owned);
        summary.classList.toggle('hidden', wishlist.length === 0);
        $('wlCount').textContent = wishlist.length;
        const total = wanted.reduce((s, i) => s + costOf(i), 0);
        $('wlTotal').textContent = naira(total);
        $('wlBalance').textContent = balance == null ? '\u2026' : naira(balance);
        let afford = '';
        if (balance != null && wanted.length) {
            const sorted = wanted.map(costOf).sort((a, b) => a - b);
            let left = balance, n = 0;
            for (const c of sorted) { if (c <= left) { left -= c; n++; } else break; }
            afford = n >= wanted.length ? 'You can afford everything on your list.'
                : n === 0 ? 'Add ' + naira(sorted[0] - balance) + ' to get your cheapest item.'
                : 'You can afford ' + n + ' of ' + wanted.length + ' right now.';
        }
        $('wlAfford').textContent = afford;
    }

    // ---- list ----------------------------------------------------------------
    function visible() {
        const q = $('bookmarkSearch').value.toLowerCase().trim(), type = $('typeFilter').value, sort = $('sortSelect').value;
        const out = wishlist.filter((i) => (!q || (i.title || '').toLowerCase().includes(q) || (i.course || '').toLowerCase().includes(q)) && (type === 'all' || i.type === type));
        out.sort((a, b) => sort === 'low' ? costOf(a) - costOf(b)
            : sort === 'high' ? costOf(b) - costOf(a)
            : sort === 'course' ? String(a.course).localeCompare(String(b.course))
            : (b.savedAt ? new Date(b.savedAt) : 0) - (a.savedAt ? new Date(a.savedAt) : 0) || a._order - b._order);
        return out;
    }

    function render() {
        renderSummary();
        const items = visible();
        grid.innerHTML = '';
        if (items.length === 0) {
            const none = wishlist.length > 0;
            $('emptyTitle').textContent = none ? 'Nothing matches' : 'Your wishlist is empty';
            $('emptyText').textContent = none ? 'Try a different search or type.' : 'Tap the heart on any resource to save it here for later.';
            $('emptyCta').classList.toggle('hidden', none);
            grid.classList.add('hidden'); empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden'); grid.classList.remove('hidden');
        items.forEach((item) => grid.appendChild(card(item)));
    }

    function card(item) {
        const cost = costOf(item);
        const ext = escapeHtml((item.fileExtension || 'pdf').replace('.', '').slice(0, 4).toUpperCase());
        const short = balance != null && !item.owned && cost > balance ? cost - balance : 0;
        const el = document.createElement('article');
        el.className = 'wl-card' + (item.owned ? ' is-owned' : '');
        el.innerHTML =
            '<div class="wl-cover"><span class="wl-ext">' + ext + '</span><span class="wl-type">' + escapeHtml(item.type) + '</span>' +
            '<button type="button" class="wl-heart" aria-label="Remove from wishlist" title="Remove from wishlist">' + HEART + '</button></div>' +
            '<div class="wl-body"><h3 class="wl-title">' + escapeHtml(item.title) + '</h3>' +
            '<p class="wl-meta">' + [item.course, item.level].filter(Boolean).map(escapeHtml).join(' \u2022 ') + '</p>' +
            '<p class="wl-meta">' + [item.pages ? item.pages + (item.pages === 1 ? ' page' : ' pages') : '', item.size].filter(Boolean).map(escapeHtml).join(' \u2022 ') + '</p></div>' +
            '<div class="wl-foot">' + (item.owned
                ? '<span class="wl-owned">\u2713 Downloaded</span><a class="wl-btn ghost" href="downloads.html">In Downloads</a>'
                : '<div class="wl-price"><strong>' + naira(cost) + '</strong>' + (short ? '<small>Add ' + naira(short) + ' to afford</small>' : '') + '</div>' +
                  '<button type="button" class="wl-btn">Download</button>') + '</div>';
        el.querySelector('.wl-heart').addEventListener('click', () => remove(item));
        const buy = el.querySelector('button.wl-btn');
        if (buy) buy.addEventListener('click', () => get(item));
        return el;
    }

    // ---- actions ---------------------------------------------------------------
    function get(item) {
        if (!W()) return;
        W().charge(item.id, item.course + ' \u2014 ' + item.title, costOf(item)).then((d) => {
            if (!d.success) return; // charge() already showed the right modal or toast
            if (d.fileUrl && !window.open(d.fileUrl, '_blank')) window.location.href = d.fileUrl;
            item.owned = true;
            W().showToast(d.alreadyOwned ? '\u201C' + item.title + '\u201D download started.' : W().formatNaira(d.amountCharged) + ' deducted \u00B7 \u201C' + item.title + '\u201D download started.');
            refreshBalance();
        });
    }

    function toggle(id) {
        return authFetch(API_BASE + '/bookmarks/' + id, { method: 'POST' }).then((r) => r.json());
    }

    function remove(item) {
        toggle(item.id).then((d) => {
            if (!d.success) { W() && W().showToast(d.message || 'Could not update wishlist.'); return; }
            wishlist = wishlist.filter((i) => i.id !== item.id);
            render();
            showSnack('Removed from your wishlist.', () => toggle(item.id).then((x) => { if (x.success) load(); }));
        }).catch(() => W() && W().showToast('Network error \u2014 could not update wishlist.'));
    }

    ['bookmarkSearch'].forEach((id) => $(id).addEventListener('input', render));
    ['typeFilter', 'sortSelect'].forEach((id) => $(id).addEventListener('change', render));
    $('wlFundBtn').addEventListener('click', () => W() && W().openFundModal());
    load();
});
