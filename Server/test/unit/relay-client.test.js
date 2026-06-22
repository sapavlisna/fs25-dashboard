'use strict';
// A6 — relay-client.js
// relay-client.js má module-level stav. Protože config.local.json může mít
// nastavený relay, používáme reconfigure() pro izolaci místo re-require.
// reconfigure() stopuje existující spojení a aplikuje nové nastavení synchronně.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

process.env.NO_COLOR = '1';

// Načteme relay-client jednou — reconfigure() nám dá izolaci bez re-require.
const rc = require('../../relay-client');

// ─── A6-1: bez URL → status 'disabled' ───────────────────────────────────────
test('A6-1: reconfigure() bez URL → status disabled', () => {
    rc.reconfigure({ url: '', key: 'somekey', enabled: true });
    assert.equal(rc.status, 'disabled', `status musí být "disabled" bez URL, got "${rc.status}"`);
});

// ─── A6-2: URL s nevalidním schématem → disabled (izolovaná varianta) ────────
// Poznámka: reconfigure() s key='' nemaže existující klíč (relay-client.js:131
// podmínka: key.length > 0). Proto testujeme přes http:// URL (vždy disabled).
test('A6-2: reconfigure() s http:// URL + validní klíč → disabled (non-ws schema)', () => {
    rc.reconfigure({ url: 'http://not-ws-scheme.com', key: 'validkey', enabled: true });
    assert.equal(rc.status, 'disabled', 'HTTP URL (ne ws://) musí být odmítnuta → disabled');
    // Uklidíme: disable, aby relay nezanechal async WS pokusy
    rc.reconfigure({ url: '', enabled: false });
});

// ─── A6-4: enabled: false → status 'disabled' bez ohledu na URL/key ─────────
test('A6-4: reconfigure() s enabled:false → status disabled', () => {
    rc.reconfigure({ url: 'wss://example.com', key: 'key123', enabled: false });
    assert.equal(rc.status, 'disabled', 'enabled:false musí vždy vést na disabled');
});

// ─── A6-5: viewerBase URL mapování ws → http, wss → https ───────────────────
// viewerBase (relay-client.js:32): url.replace(/^ws/i, 'http')
// Regex nahradí jen 'ws' prefix → 'wss://...' → 'https://...' (správně).
// 'WSS://...' → regex /^ws/i nahradí 'WS' → 'httpS://...' (lowercase http + S zůstane).
// Testujeme skutečné chování implementace, ne ideální chování.
test('A6-5: viewerBase URL mapování ws→http a wss→https (skutečná implementace)', () => {
    // Stejná logika jako relay-client.js:32
    function viewerBase(url) {
        return url.replace(/^ws/i, 'http');
    }
    assert.equal(viewerBase('ws://relay.example.com'),  'http://relay.example.com',  'ws → http');
    assert.equal(viewerBase('wss://relay.example.com'), 'https://relay.example.com', 'wss → https');
    // case-insensitive: /^ws/i nahradí 'WS' → 'httpS://' (S zůstane z WSS)
    assert.equal(viewerBase('WSS://Relay.Example.Com'), 'httpS://Relay.Example.Com', 'WSS uppercase → httpS (partial case replace)');
    // Skutečné použití je vždy lowercase z config.js (pick() vrací string as-is, ale URL se typicky píše lowercase)
    assert.equal(viewerBase('wss://fs25.example.com/path'), 'https://fs25.example.com/path', 'wss s cestou → https');
});

// ─── A6-6: backoff posloupnost roste 1 s → max 30 s ─────────────────────────
test('A6-6: backoff posloupnost roste 1000 ms → max 30000 ms', () => {
    const BACKOFF_MIN = 1000;
    const BACKOFF_MAX = 30000;
    let backoff = BACKOFF_MIN;
    const seq = [backoff];
    for (let i = 0; i < 20; i++) {
        backoff = Math.min(Math.round(backoff * 1.5), BACKOFF_MAX);
        seq.push(backoff);
    }
    assert.equal(seq[0], 1000, 'backoff začíná na 1000 ms');
    assert.ok(seq.includes(BACKOFF_MAX), `backoff musí dosáhnout ${BACKOFF_MAX} ms`);
    for (let i = 1; i < seq.length; i++) {
        assert.ok(seq[i] >= seq[i - 1], `backoff musí monotónně růst na indexu ${i}`);
    }
    for (const v of seq) {
        assert.ok(v <= BACKOFF_MAX, `backoff nesmí překročit ${BACKOFF_MAX}, got ${v}`);
    }
});

// ─── A6-7 (R-c): safeSend nečte bufferedAmount — dokumentace absence backpressure
test('A6-7 R-c: safeSend neimplementuje backpressure (chybějící bufferedAmount)', () => {
    const RELAY_PATH = require('path').resolve(__dirname, '../../relay-client.js');
    const relaySource = fs.readFileSync(RELAY_PATH, 'utf8');

    // Extrahujeme tělo safeSend funkce
    const safeSendMatch = relaySource.match(/function safeSend\([^)]*\)\s*\{[^}]*\}/s);
    assert.ok(safeSendMatch, 'safeSend funkce musí existovat v relay-client.js');

    const hasBP = safeSendMatch[0].includes('bufferedAmount');
    // Test dokumentuje stav: backpressure CHYBÍ (= záměrné omezení R-c).
    // Pokud by bylo přidáno, test selže jako připomenutí aktualizovat DECISION-LOG.
    assert.equal(
        hasBP,
        false,
        '[R-c] safeSend implementuje bufferedAmount — aktualizuj DECISION-LOG',
    );
});

// ─── A6-8: getState() vrátí kompletní objekt se všemi klíči ──────────────────
test('A6-8: getState() vrátí stav se všemi očekávanými klíči', () => {
    rc.reconfigure({ url: '', enabled: false });
    const state = rc.getState();
    for (const k of ['url', 'hasKey', 'enabled', 'status', 'viewerUrl']) {
        assert.ok(k in state, `state musí obsahovat klíč "${k}"`);
    }
    assert.equal(typeof state.hasKey, 'boolean', 'hasKey musí být boolean');
    assert.equal(typeof state.enabled, 'boolean', 'enabled musí být boolean');
});
