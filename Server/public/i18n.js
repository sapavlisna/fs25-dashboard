// i18n.js — lightweight multi-language layer for the dashboard.
//
// Design: dictionaries are keyed by the ORIGINAL CZECH source string, so the
// default language (cs) needs no dictionary at all — t() and the DOM walker
// are no-ops and have zero cost/risk for Czech users. A new language is added
// by dropping a `{ "<czech>": "<translation>" }` map into TRANSLATIONS.
//
// Two translation paths cover the whole UI without tagging every element:
//   1. t(cs, params) — call sites in JS renderers for interpolated strings.
//   2. applyDom(root) — walks text nodes + title/placeholder/aria-label attrs
//      and swaps any whose trimmed text exactly matches a dictionary key. A
//      debounced MutationObserver re-runs it after renderers rewrite a section,
//      so dynamically-generated markup gets translated too.
//
// Language is persisted in localStorage (fs25.dash.v1.lang) and mirrored to the
// server via ServerSync. Changing language reloads the page — simplest reliable
// way to re-translate every page + re-read t() at render time.

(function () {
    const NS = 'fs25.dash.v1.';
    const LANG_KEY = NS + 'lang';

    const AVAILABLE = [
        { id: 'cs', label: 'Čeština',  flag: '🇨🇿' },
        { id: 'en', label: 'English',  flag: '🇬🇧' },
    ];

    // Czech-source-keyed translations. cs is implicit (identity).
    // English dictionary lives in i18n.en.js (loaded before this file) so this
    // engine file stays small; fall back to an inline empty map if absent.
    const TRANSLATIONS = {
        en: (window.I18N_EN || {}),
    };

    function load() {
        try { return localStorage.getItem(LANG_KEY) || 'cs'; } catch (_) { return 'cs'; }
    }
    let current = load();

    function getLang() { return current; }
    function isDefault() { return current === 'cs'; }

    function setLang(lang) {
        if (!AVAILABLE.some(l => l.id === lang)) return;
        current = lang;
        try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
        if (window.ServerSync) window.ServerSync.syncWrite('lang', lang);
        // Full reload — re-translates every page and re-reads t() at render time.
        location.reload();
    }

    // Translate a Czech source string. `params` interpolates {0},{1},… or {name}.
    function t(cs, params) {
        let out = cs;
        if (current !== 'cs') {
            const dict = TRANSLATIONS[current];
            if (dict && Object.prototype.hasOwnProperty.call(dict, cs)) out = dict[cs];
        }
        if (params) {
            out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
        }
        return out;
    }

    // ─── DOM translation ─────────────────────────────────────────────────────
    const ATTRS = ['title', 'placeholder', 'aria-label'];

    function translateText(s) {
        const dict = TRANSLATIONS[current];
        if (!dict) return s;
        // Normalise internal whitespace so multi-line HTML text (e.g. wrapped
        // <p> hints) matches a single-line dictionary key. Preserve the node's
        // leading/trailing whitespace on replacement.
        const norm = s.replace(/\s+/g, ' ').trim();
        if (!norm) return s;
        const lead  = (s.match(/^\s*/) || [''])[0];
        const trail = (s.match(/\s*$/) || [''])[0];
        // 1) Exact match on the whole normalised string.
        if (Object.prototype.hasOwnProperty.call(dict, norm)) {
            return lead + dict[norm] + trail;
        }
        // 2) Strip a leading emoji/symbol run and a trailing non-letter run
        //    (e.g. "💰 Výkupní ceny (" → core "Výkupní ceny") and translate the
        //    core, re-attaching the prefix/suffix. Section headers carry an
        //    emoji prefix in the same text node, so this is the common case.
        const m = norm.match(/^([^\p{L}]*?)(\p{L}[\s\S]*?\p{L}|\p{L})([^\p{L}]*)$/u);
        if (m) {
            const core = m[2];
            if (Object.prototype.hasOwnProperty.call(dict, core)) {
                return lead + m[1] + dict[core] + m[3] + trail;
            }
        }
        return s;
    }

    let _walking = false;
    function applyDom(root) {
        if (current === 'cs') return;            // default → nothing to do
        const dict = TRANSLATIONS[current];
        if (!dict) return;
        root = root || document.body;
        if (!root) return;
        _walking = true;
        try {
            // Text nodes
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(n) {
                    if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    const p = n.parentNode;
                    if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                },
            });
            const nodes = [];
            for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
            for (const n of nodes) {
                const translated = translateText(n.nodeValue);
                if (translated !== n.nodeValue) n.nodeValue = translated;
            }
            // Attributes
            const els = root.querySelectorAll('[title],[placeholder],[aria-label]');
            for (const el of els) {
                for (const a of ATTRS) {
                    const v = el.getAttribute(a);
                    if (v) {
                        const tv = translateText(v);
                        if (tv !== v) el.setAttribute(a, tv);
                    }
                }
            }
        } finally {
            _walking = false;
        }
    }

    // Debounced observer: re-translate when renderers rewrite the DOM. Disconnect
    // during our own writes so we don't observe (and loop on) them.
    let _obs = null, _pending = false;
    function startObserver() {
        if (current === 'cs') return;            // no observer cost for default
        if (typeof MutationObserver === 'undefined') return;
        const target = document.body;
        if (!target) return;
        _obs = new MutationObserver(() => {
            if (_walking || _pending) return;
            _pending = true;
            requestAnimationFrame(() => {
                _pending = false;
                applyDom(document.body);
            });
        });
        _obs.observe(target, { childList: true, subtree: true, characterData: true });
    }

    function init() {
        document.documentElement.setAttribute('lang', current);
        applyDom(document.body);
        startObserver();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.I18n = { t, getLang, setLang, applyDom, AVAILABLE };
    // Convenience global shorthand used by renderers.
    window.t = t;
})();
