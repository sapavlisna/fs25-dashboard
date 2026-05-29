// replayer.js — in-server playback of a recorded diagnostic JSONL.
//
// Unlike scripts/replay.js (a standalone CLI that writes frames into
// dashboard_data.json and lets the file watcher pick them up), this drives the
// WebSocket broadcast directly: it does NOT touch the data file and does NOT
// re-enrich (recorded frames are already enriched, so re-enriching would
// overwrite them with the local savegame). It powers the hidden "mockup mode"
// where the dashboard runs from an uploaded recording instead of the live game.
//
// Supports transport-style control: play / pause / resume / seek / step, plus
// markers (moments flagged during capture) surfaced in status so the UI can
// show ticks on the scrubber and jump between them.
//
// index.js supplies a `send(payloadObj)` that broadcasts raw to clients and an
// `onStatus()` it calls whenever playback state changes (so the banner updates).

'use strict';

const fs  = require('fs');
const log = require('./logger');

const MAX_GAP_MS = 10_000;   // cap a long pause between frames so playback never stalls

let st = null;   // active playback state, or null

// Parse a recording file → { meta, frames:[{t,payload}], markers:[{t,label}] }.
function parseFile(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let meta = null;
    const frames = [];
    const markers = [];
    for (const line of lines) {
        let obj;
        try { obj = JSON.parse(line); } catch (_) { continue; }
        if (obj.meta && !meta) { meta = obj.meta; continue; }
        if (obj.payload) frames.push({ t: obj.t || 0, payload: obj.payload });
        else if (obj.marker) markers.push({ t: obj.t || 0, label: obj.marker.label || '' });
    }
    return { meta, frames, markers };
}

// Map each marker's relative time to the nearest frame index at/after it.
function markerIndices(frames, markers) {
    return markers.map(m => {
        let idx = frames.findIndex(f => f.t >= m.t);
        if (idx < 0) idx = frames.length - 1;
        return { idx: Math.max(0, idx), label: m.label };
    });
}

function isActive() { return !!st; }
function currentFrame() { return st ? st.lastFrame : null; }

function status() {
    if (!st) return { active: false };
    return {
        active:  true,
        name:    st.name,
        idx:     st.cur,
        total:   st.frames.length,
        speed:   st.speed,
        loop:    st.loop,
        paused:  st.paused,
        done:    st.cur >= st.frames.length - 1 && !st.loop && !st.timer && !st.paused,
        markers: st.markers,
    };
}

function clampIdx(i) {
    return Math.max(0, Math.min(st.frames.length - 1, i));
}

// Send frame `i` to clients and record it as current. Also pushes a status
// update so the scrubber/counter in the banner track auto-advancing playback.
function emit(i) {
    st.cur = clampIdx(i);
    const fr = st.frames[st.cur];
    st.lastFrame = fr.payload;
    try { st.send(fr.payload); } catch (_) {}
    if (st.onStatus) st.onStatus();
}

// Schedule the frame AFTER index `i`, honouring recorded inter-frame timing.
function scheduleAfter(i) {
    if (!st) return;
    const cur = st.frames[i];
    const next = st.frames[i + 1];
    if (!next) {
        if (st.loop) {
            st.timer = setTimeout(() => { if (!st) return; emit(0); afterEmit(0); }, 2000 / st.speed);
        } else {
            st.timer = null;                 // finished — hold last frame
            if (st.onStatus) st.onStatus();
        }
        return;
    }
    const delay = Math.max(0, Math.min(MAX_GAP_MS, next.t - cur.t)) / st.speed;
    st.timer = setTimeout(() => { if (!st) return; emit(i + 1); afterEmit(i + 1); }, delay);
}

function afterEmit(i) {
    if (!st) return;
    if (st.paused) { st.timer = null; return; }
    scheduleAfter(i);
}

function clearTimer() {
    if (st && st.timer) { clearTimeout(st.timer); st.timer = null; }
}

function start({ filePath, name, speed = 1, loop = false, send, onStatus }) {
    stop();
    const { meta, frames, markers } = parseFile(filePath);
    if (!frames.length) throw new Error('Recording has no frames');
    st = {
        name, frames, meta,
        markers: markerIndices(frames, markers),
        cur: 0, timer: null, paused: false,
        speed: speed > 0 ? speed : 1,
        loop: !!loop,
        send, onStatus,
        lastFrame: null,
    };
    log.info('replay', `přehrávám ${name} — ${frames.length} rámců${st.markers.length ? ', ' + st.markers.length + ' značek' : ''}, ${st.speed}×${st.loop ? ', smyčka' : ''}`);
    emit(0);
    afterEmit(0);
    return status();
}

function pause() {
    if (!st || st.paused) return status();
    clearTimer();
    st.paused = true;
    if (st.onStatus) st.onStatus();
    return status();
}

function resume() {
    if (!st || !st.paused) return status();
    st.paused = false;
    afterEmit(st.cur);
    if (st.onStatus) st.onStatus();
    return status();
}

function seek(i) {
    if (!st) return status();
    clearTimer();
    emit(i);
    if (!st.paused) afterEmit(st.cur);
    return status();
}

// Step a single frame; stepping implies paused so you can inspect.
function step(delta) {
    if (!st) return status();
    clearTimer();
    st.paused = true;
    emit(st.cur + (delta || 0));
    return status();
}

function stop() {
    if (!st) return null;
    clearTimer();
    log.info('replay', `přehrávání zastaveno (${st.name})`);
    st = null;
    return { active: false };
}

module.exports = {
    start, stop, pause, resume, seek, step,
    isActive, currentFrame, status, parseFile,
};
