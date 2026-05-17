// money.js — shared currency formatting used by every dashboard page.
//
// The mod always reports raw EUR values. When AdditionalCurrencies' converter
// is ON in-game, the WS payload carries { code, symbol, factor, prefix,
// converter:true } so the dashboard can multiply and re-label to match the
// in-game HUD. Each page registers a WS listener (via app.js) that calls
// FS25Money.setCurrency(payload.currency) — the result is cached in
// localStorage so pages that load with REST-only (history.html) still pick
// up the last known conversion settings between dashboard sessions.

(function () {
    const KEY = 'fs25.dash.v1.currency';
    const DEFAULT = { code: 'EUR', symbol: '€', factor: 1, prefix: true, converter: false };

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) return { ...DEFAULT };
            return { ...DEFAULT, ...JSON.parse(raw) };
        } catch (_) { return { ...DEFAULT }; }
    }

    let current = load();

    function setCurrency(c) {
        if (!c || typeof c !== 'object') return;
        current = { ...DEFAULT, ...c };
        try { localStorage.setItem(KEY, JSON.stringify(current)); } catch (_) {}
    }

    function get() { return current; }

    // Format a raw EUR amount using the active currency context.
    function format(eurAmount, opts) {
        const c = current;
        const n = Number(eurAmount) || 0;
        const value = c.converter ? n * (c.factor || 1) : n;
        const rounded = Math.round(value);
        const num = rounded.toLocaleString('cs-CZ');
        const sym = c.symbol || '';
        if (opts && opts.signed) {
            const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
            const abs  = Math.abs(rounded).toLocaleString('cs-CZ');
            return c.prefix ? `${sign}${sym} ${abs}` : `${sign}${abs} ${sym}`;
        }
        return c.prefix ? `${sym} ${num}` : `${num} ${sym}`;
    }

    // Return just the currency symbol for axis labels / tick callbacks.
    function symbol() { return current.symbol || ''; }

    // Convert a raw EUR amount to display units (without formatting) — useful
    // for chart Y-axis ticks where Chart.js needs numbers in display space.
    function toDisplay(eurAmount) {
        const c = current;
        const n = Number(eurAmount) || 0;
        return c.converter ? n * (c.factor || 1) : n;
    }

    window.FS25Money = { setCurrency, get, format, symbol, toDisplay };
})();
