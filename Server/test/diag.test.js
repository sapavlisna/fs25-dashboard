'use strict';
// diag.test.js — dependency-free self-test for the diagnostic capture & replay
// pipeline (recorder.js + scripts/replay.js). No server, game, or browser.
//
//   node test/diag.test.js
//
// Isolates DATA_DIR to a temp folder and uses a tiny ring cap so the keep-last-N
// behaviour is exercised deterministically.

const assert = require('assert');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');

// Must be set BEFORE requiring recorder (config.js reads these at load time).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fs25-diag-'));
process.env.DASHBOARD_DATA_DIR        = TMP;
process.env.DASHBOARD_REC_MAX_FRAMES  = '5';
process.env.NO_COLOR                  = '1';

const recorder = require('../recorder');

function ok(name)  { console.log('  ✓ ' + name); }
function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} }
function bail(e)   { console.error('\nDIAG SELFTEST FAIL:', e && e.message || e); cleanup(); process.exit(1); }

try {
    // 1) start → file exists with a meta line
    const { name, file } = recorder.start({ note: 'test bug', lang: 'en' });
    assert.ok(fs.existsSync(file), 'recording file created on start');
    assert.ok(/^rec-.*\.jsonl$/.test(name), 'name follows rec-*.jsonl pattern');
    ok('start creates file');

    // 2) append 8 frames (cap 5) → identity lifted from first frame, ring trims
    recorder.appendFrame({ modVersion: '1.2.3', schemaVersion: 1, saveMeta: { name: 'Hof X' }, gameDay: 1 });
    for (let d = 2; d <= 8; d++) recorder.appendFrame({ gameDay: d });
    const st = recorder.status();
    assert.strictEqual(st.active, true, 'status active');
    assert.strictEqual(st.frames, 5, 'ring capped at 5 frames');
    assert.strictEqual(st.truncated, true, 'truncated flag set after overflow');
    ok('ring cap + truncated flag');

    // 2b) client-log folds JS errors + a settings snapshot into the recording
    recorder.noteClient({
        errors:   [{ kind: 'error', message: 'boom', stack: 'at x' }],
        settings: { page: '/', lang: 'en', values: { 'fs25.dash.v1.theme': '"dark-green"' } },
    });
    assert.strictEqual(recorder.status().clientErrors, 1, 'client error folded into active recording');
    ok('client-log folded into recording');

    // 3) stop → summary + on-disk format
    const res = recorder.stop();
    assert.strictEqual(res.frames, 5, 'stop reports 5 kept frames');
    assert.strictEqual(res.totalSeen, 8, 'stop reports 8 total seen');

    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const meta  = JSON.parse(lines[0]).meta;
    assert.strictEqual(meta.note, 'test bug', 'note persisted');
    assert.strictEqual(meta.lang, 'en', 'lang persisted');
    assert.strictEqual(meta.modVersion, '1.2.3', 'modVersion lifted from frame');
    assert.strictEqual(meta.saveName, 'Hof X', 'saveName lifted from frame');
    assert.strictEqual(meta.truncated, true, 'meta truncated flag');
    const entries = lines.slice(1).map(l => JSON.parse(l));
    const days = entries.filter(e => e.payload).map(e => e.payload.gameDay);
    assert.deepStrictEqual(days, [4, 5, 6, 7, 8], 'kept the LAST 5 frames (ring)');
    ok('stop writes meta + last-N frames in order');

    // 3b) client error line + settings snapshot persisted
    const clientEntries = entries.filter(e => e.client);
    assert.strictEqual(clientEntries.length, 1, 'one client error line written');
    assert.strictEqual(clientEntries[0].client.message, 'boom', 'client error message preserved');
    assert.strictEqual(meta.clientErrors, 1, 'meta clientErrors count');
    assert.ok(meta.clientSettings && meta.clientSettings.lang === 'en', 'meta clientSettings snapshot persisted');
    ok('client errors + settings persisted to recording');

    // 4) list + path-traversal guard
    const listed = recorder.list();
    assert.strictEqual(listed.length, 1, 'one recording listed');
    assert.strictEqual(listed[0].frames, 5, 'listed frame count from meta');
    assert.strictEqual(recorder.resolve('../../secret'), null, 'traversal name rejected');
    assert.ok(recorder.resolve(name), 'valid name resolves');
    ok('list + traversal guard');

    // 5) replay parses the file and writes a recorded frame to OUTPUT
    const OUT = path.join(TMP, 'replay-out.json');
    const child = spawn(
        process.execPath,
        [path.join(__dirname, '..', 'scripts', 'replay.js'), file, '--step', OUT],
        { stdio: 'ignore', env: process.env },
    );
    setTimeout(() => {
        child.kill('SIGINT');
        try {
            assert.ok(fs.existsSync(OUT), 'replay wrote output file');
            const payload = JSON.parse(fs.readFileSync(OUT, 'utf8'));
            assert.ok(payload.gameDay >= 4, 'replay output is one of the recorded frames');
            ok('replay writes recorded frames to output');
            cleanup();
            console.log('\nDIAG SELFTEST PASS');
            process.exit(0);
        } catch (e) { bail(e); }
    }, 1500);
} catch (e) {
    bail(e);
}
