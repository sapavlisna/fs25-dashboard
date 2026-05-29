#!/usr/bin/env node
// replay.js — play a recorded diagnostic JSONL back into dashboard_data.json so
// the running server broadcasts it to the dashboard exactly as if the FS25 mod
// were live. Pair with `npm start` in another terminal, then open the dashboard.
//
// A recording is produced by the server's diagnostic recorder (recorder.js) —
// see POST /diag/record/start. The file is self-contained: line 1 is a meta
// object, the rest are { "t": <ms-from-start>, "payload": {…} } frames.
//
// Usage:
//   npm run replay -- <recording> [--speed=N] [--loop] [--step] [out.json]
//   node scripts/replay.js data/recordings/rec-….jsonl --speed=4 --loop
//
// <recording> may be a path OR a bare name living in <DATA_DIR>/recordings/.
//
//   --speed=N   playback rate multiplier (default 1 = original cadence)
//   --loop      restart from the first frame after the last
//   --step      ignore timestamps; emit one frame every 2 s wall-clock
//   out.json    override output file (default: config.DATA_FILE)
//
// A single huge gap between frames (e.g. the game was paused) is capped at
// MAX_GAP_MS so replay never appears to hang.

'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('../config');

const MAX_GAP_MS = 10_000;

function fail(msg) { console.error(`[replay] ${msg}`); process.exit(1); }

// ─── CLI parsing ──────────────────────────────────────────────────────────────
let SRC = null;
let OUTPUT = config.DATA_FILE;
let speed = 1;
let loop = false;
let step = false;

for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--speed=')) {
        speed = parseFloat(arg.slice('--speed='.length));
        if (!(speed > 0)) fail(`Invalid --speed (${arg})`);
    } else if (arg === '--loop') {
        loop = true;
    } else if (arg === '--step') {
        step = true;
    } else if (arg.startsWith('--')) {
        fail(`Unknown flag ${arg}`);
    } else if (arg.endsWith('.json') && !arg.endsWith('.jsonl')) {
        OUTPUT = arg;
    } else {
        SRC = arg;
    }
}

if (!SRC) {
    fail('Missing recording. Usage: npm run replay -- <recording.jsonl> [--speed=N] [--loop] [--step]');
}

// ─── Resolve the recording path ────────────────────────────────────────────────
function resolveSrc(s) {
    if (fs.existsSync(s)) return s;
    const inDir = path.join(config.DATA_DIR, 'recordings', s);
    if (fs.existsSync(inDir)) return inDir;
    return null;
}

const srcPath = resolveSrc(SRC);
if (!srcPath) fail(`Recording not found: ${SRC} (also looked in ${path.join(config.DATA_DIR, 'recordings')})`);

// ─── Parse frames ──────────────────────────────────────────────────────────────
const lines = fs.readFileSync(srcPath, 'utf8').split('\n').filter(l => l.trim());
if (!lines.length) fail('Recording is empty');

let meta = null;
const frames = [];
for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (obj.meta && !meta) { meta = obj.meta; continue; }
    if (obj.payload) frames.push({ t: obj.t || 0, payload: obj.payload });
}
if (!frames.length) fail('Recording has no frames');

// ─── Output prep ────────────────────────────────────────────────────────────────
const outDir = path.dirname(OUTPUT);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function writeFrame(fr) {
    fs.writeFileSync(OUTPUT, JSON.stringify(fr.payload));
}

// ─── Playback ─────────────────────────────────────────────────────────────────
let i = 0;
let timer = null;

function progress() {
    const fr = frames[i];
    const day = fr.payload.gameDay != null ? `Day ${fr.payload.gameDay}` : '';
    process.stdout.write(`\r[replay] frame ${i + 1}/${frames.length} | t=${(fr.t / 1000).toFixed(1)}s | ${day}        `);
}

function step1() {
    if (i >= frames.length) {
        if (loop) { i = 0; }
        else { process.stdout.write('\n[replay] done — holding last frame. Ctrl+C to stop.\n'); return; }
    }
    writeFrame(frames[i]);
    progress();

    const cur = frames[i];
    const next = frames[i + 1];
    i++;

    let delay;
    if (step) {
        delay = 2000 / speed;
    } else if (next) {
        delay = Math.max(0, Math.min(MAX_GAP_MS, next.t - cur.t)) / speed;
    } else if (loop) {
        delay = 2000 / speed;   // pause before looping back
    } else {
        delay = 0;              // last frame, will stop next tick
    }
    timer = setTimeout(step1, delay);
}

console.log(`\n[replay] source : ${srcPath}`);
console.log(`[replay] output : ${OUTPUT}`);
console.log(`[replay] frames : ${frames.length}` +
    (meta ? ` | save="${meta.saveName || '?'}" mod=${meta.modVersion || '?'} schema=${meta.schemaVersion ?? '?'}` : ''));
if (meta && meta.note) console.log(`[replay] note   : ${meta.note}`);
console.log(`[replay] speed=${speed}x${loop ? ' loop' : ''}${step ? ' step' : ''} — Ctrl+C to stop.\n`);

step1();

process.on('SIGINT', () => {
    if (timer) clearTimeout(timer);
    process.stdout.write('\n[replay] Stopped.\n');
    process.exit(0);
});
