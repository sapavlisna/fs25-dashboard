// sortable.js — click any <th> to sort the table.
// Auto-attaches to every <table> inside .table-wrap on DOMContentLoaded.
//
// Conventions:
//   - <th class="num">  → numeric sort (parses digits, strips Kč/ha/%/spaces)
//   - other <th>        → case-insensitive string sort
//
// Group separators (e.g. <tr class="st-row"><td colspan="N">…</td></tr> in
// storage/prices tables) are detected by a single full-width cell and kept in
// place; items are sorted within each group.
//
// Re-render safe: a MutationObserver re-applies the active sort whenever the
// tbody is swapped out (every WS tick).

(function () {
    const STATE = new WeakMap();   // table → { col, dir }
    const SUPPRESS = new WeakSet(); // tbodies we're currently sorting (avoid observer recursion)

    // Persist active sort per table. The table opts in via `data-sort-key="..."`;
    // tables without that attribute don't persist.
    const LS_PREFIX = 'fs25.dash.v1.sort.';
    function loadSavedSort(table) {
        const key = table.dataset.sortKey;
        if (!key) return null;
        try {
            const raw = localStorage.getItem(LS_PREFIX + key);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (obj && Number.isInteger(obj.col) && (obj.dir === 'asc' || obj.dir === 'desc')) return obj;
        } catch (_) {}
        return null;
    }
    function saveSort(table, state) {
        const key = table.dataset.sortKey;
        if (!key || !state || state.col == null) return;
        try {
            localStorage.setItem(LS_PREFIX + key, JSON.stringify({ col: state.col, dir: state.dir }));
        } catch (_) {}
    }

    function isGroupRow(tr, ncols) {
        const cells = tr.children;
        if (cells.length !== 1) return false;
        const cs = parseInt(cells[0].getAttribute('colspan') || '1', 10);
        return cs >= ncols;
    }

    function isEmptyRow(tr) {
        return tr.querySelector('td.empty') !== null;
    }

    function cellValue(tr, idx, numeric) {
        const td = tr.children[idx];
        if (!td) return numeric ? 0 : '';
        const txt = td.textContent.replace(/ /g, ' ').trim();
        if (numeric) {
            const m = txt.match(/-?\d[\d\s.,]*/);
            if (!m) return Number.NEGATIVE_INFINITY;
            const n = parseFloat(m[0].replace(/\s+/g, '').replace(',', '.'));
            return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
        }
        return txt.toLocaleLowerCase('cs-CZ');
    }

    function applySort(table) {
        const state = STATE.get(table);
        if (!state || state.col == null) return;

        const tbody = table.tBodies[0];
        const thead = table.tHead;
        if (!tbody || !thead || !thead.rows[0]) return;

        const ths = thead.rows[0].cells;
        const ncols = ths.length;
        const numeric = ths[state.col].classList.contains('num');

        const rows = Array.from(tbody.rows);
        if (rows.length === 0) return;
        if (rows.length === 1 && isEmptyRow(rows[0])) return;

        // Slice into [groupSep, ...items][]
        const groups = [];
        let cur = { sep: null, items: [] };
        for (const tr of rows) {
            if (isGroupRow(tr, ncols)) {
                if (cur.sep || cur.items.length) groups.push(cur);
                cur = { sep: tr, items: [] };
            } else {
                cur.items.push(tr);
            }
        }
        if (cur.sep || cur.items.length) groups.push(cur);

        const dir = state.dir === 'asc' ? 1 : -1;
        for (const g of groups) {
            g.items.sort((a, b) => {
                const va = cellValue(a, state.col, numeric);
                const vb = cellValue(b, state.col, numeric);
                if (va < vb) return -1 * dir;
                if (va > vb) return  1 * dir;
                return 0;
            });
        }

        SUPPRESS.add(tbody);
        const frag = document.createDocumentFragment();
        for (const g of groups) {
            if (g.sep) frag.appendChild(g.sep);
            for (const it of g.items) frag.appendChild(it);
        }
        tbody.appendChild(frag);
        // microtask delay so the observer's pending callback (if any) sees the flag
        Promise.resolve().then(() => SUPPRESS.delete(tbody));

        for (let i = 0; i < ths.length; i++) ths[i].classList.remove('sort-asc', 'sort-desc');
        ths[state.col].classList.add(state.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    function attach(table) {
        if (!table || !table.tHead || !table.tHead.rows[0]) return;
        if (table.dataset.sortable === '1') return;
        table.dataset.sortable = '1';

        // Restore saved sort, or fall back to data-default-sort="col:dir".
        let initial = loadSavedSort(table);
        if (!initial && table.dataset.defaultSort) {
            const [c, d] = table.dataset.defaultSort.split(':');
            const ci = parseInt(c, 10);
            if (Number.isInteger(ci) && (d === 'asc' || d === 'desc')) initial = { col: ci, dir: d };
        }
        if (initial) STATE.set(table, initial);

        const ths = table.tHead.rows[0].cells;
        for (let i = 0; i < ths.length; i++) {
            const th = ths[i];
            if (th.dataset.noSort === '1') continue;
            th.classList.add('sortable');
            const colIdx = i;
            th.addEventListener('click', () => {
                const s = STATE.get(table) || { col: null, dir: 'asc' };
                if (s.col === colIdx) {
                    s.dir = s.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    s.col = colIdx;
                    s.dir = 'asc';
                }
                STATE.set(table, s);
                saveSort(table, s);
                applySort(table);
            });
        }

        const tbody = table.tBodies[0];
        if (tbody) {
            const obs = new MutationObserver(() => {
                if (SUPPRESS.has(tbody)) return;
                applySort(table);
            });
            obs.observe(tbody, { childList: true });
        }
    }

    function autoAttach() {
        document.querySelectorAll('.table-wrap table').forEach(attach);
    }

    document.addEventListener('DOMContentLoaded', autoAttach);
    window.Sortable = { attach, autoAttach };
})();
