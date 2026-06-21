// diag.js — client-side diagnostic capture.
//
// Keeps a small ring of recent JS problems (uncaught errors, unhandled promise
// rejections, console.error calls) and forwards each — plus a one-time settings
// + environment snapshot on page load — to the server's POST /diag/client-log.
// The server folds them into an active diagnostic recording (recorder.js) so a
// replayed bug carries not just the data the user saw but the JS errors and the
// exact settings/viewport they had. Lightweight + always-on: a network post
// only happens on a real error (rare) and once per page load.
//
// Must load early (right after state.js, before app.js / renderers) so the
// error listeners are registered before any later script can throw.

(function () {
    const MAX = 50;
    const ring = [];

    function post(body) {
        if (window.readOnlyMode) return;   // relay has no /diag/* endpoints
        try {
            fetch('/diag/client-log', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                keepalive: true,            // survive a page unload mid-send
            }).catch(function () {});
        } catch (_) {}
    }

    function record(entry) {
        entry.clientTime = new Date().toISOString();
        entry.page = location.pathname;
        ring.push(entry);
        while (ring.length > MAX) ring.shift();
        post({ errors: [entry] });
    }

    window.addEventListener('error', function (e) {
        record({
            kind:    'error',
            message: String((e && e.message) || (e && e.error && e.error.message) || 'error'),
            source:  (e && e.filename) || '',
            line:    (e && e.lineno) || 0,
            col:     (e && e.colno) || 0,
            stack:   e && e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : '',
        });
    });

    window.addEventListener('unhandledrejection', function (e) {
        const r = e && e.reason;
        record({
            kind:    'unhandledrejection',
            message: String((r && r.message) || r || 'rejection'),
            stack:   r && r.stack ? String(r.stack).slice(0, 2000) : '',
        });
    });

    // Wrap console.error but always call through to the original.
    const origErr = console.error.bind(console);
    console.error = function () {
        const args = Array.prototype.slice.call(arguments);
        try {
            record({
                kind: 'console',
                message: args.map(function (a) {
                    try { return typeof a === 'string' ? a : JSON.stringify(a); }
                    catch (_) { return String(a); }
                }).join(' ').slice(0, 2000),
            });
        } catch (_) {}
        origErr.apply(console, args);
    };

    // One-time settings + environment snapshot (after other scripts initialised).
    function snapshot() {
        const values = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.indexOf('fs25.dash.') === 0) values[k] = localStorage.getItem(k);
            }
        } catch (_) {}
        post({
            settings: {
                page:   location.pathname,
                lang:   (window.I18n && window.I18n.getLang && window.I18n.getLang()) || 'cs',
                ua:     navigator.userAgent,
                screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
                values: values,
            },
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(snapshot, 400); });
    } else {
        setTimeout(snapshot, 400);
    }

    // Exposed for debugging / a future settings panel ("show recent errors").
    window.Diag = { recent: function () { return ring.slice(); } };
})();
