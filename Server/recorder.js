// recorder.js — diagnostic capture of the live dashboard payload stream.
//
// When recording is active, every enriched payload the server broadcasts to
// clients is appended (in an in-memory ring, capped) and periodically flushed
// to a single self-contained JSONL file under <DATA_DIR>/recordings/:
//
//   line 1     {"meta":{ startedAt, note, lang, modVersion, schemaVersion,
//                         saveName, serverVersion, frames, totalSeen,
//                         durationMs, truncated, capFrames }}
//   line 2..N  {"t":<ms-from-start>,"payload":{…full enriched payload…}}
//
// The file replays via scripts/replay.js, which feeds the frames back into
// DATA_FILE at their original cadence so the whole server→WS→UI pipeline
// renders exactly what the recorder saw. Recording is mode-agnostic (a user
// hitting a bug records on their own machine and sends the one file over);
// replaying is a dev/mock-side concern.
//
// Ring semantics: we keep the LAST `capFrames` frames in memory (a bug usually
// lives near the end of a session), flush every few frames for crash-safety,
// and rewrite the whole file from the ring on each flush.

'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('./config');
const log    = require('./logger');
const pkg    = require('./package.json');

const CAP_FRAMES   = Math.max(1, parseInt(process.env.DASHBOARD_REC_MAX_FRAMES || '1000', 10));
const CAP_CLIENT   = 200;   // ring cap for client log lines within a recording
const FLUSH_EVERY  = 10;    // frames between full-file flushes

// Only basenames matching this may be downloaded/deleted/resolved — guards
// against path traversal via the :name route param.
const NAME_RE = /^rec-[0-9A-Za-z._-]+\.jsonl$/;

let rec = null;   // active recording state, or null

// Small global ring of recent client errors, kept even when NOT recording, so
// a recording started right after a crash can still report "there were errors"
// and so status() can surface them. Capped, newest last.
const recentClient = [];
const CAP_RECENT   = 50;
let   lastClientSettings = null;   // most recent client settings/env snapshot

// Always-on rolling buffer of recent enriched frames (independent of any active
// recording) so a bug can be captured RETROACTIVELY — the user clicks "save the
// last frames" only after they notice something went wrong.
const CAP_ROLL = Math.max(1, parseInt(process.env.DASHBOARD_REC_BUFFER_FRAMES || '600', 10));
const rolling  = [];               // [{ ts, payload }]
const rollingMarkers = [];         // [{ ts, label }] — markers for retroactive saves
const CAP_MARKS = 50;

// Feed every broadcast frame: into the rolling buffer (always) and into the
// active recording (if one is running). index.js calls this per tick.
function observe(payload) {
    if (!payload || typeof payload !== 'object') return;
    rolling.push({ ts: Date.now(), payload });
    while (rolling.length > CAP_ROLL) rolling.shift();
    appendFrame(payload);
}

function recordingsDir() {
    return path.join(config.DATA_DIR, 'recordings');
}

function isActive() {
    return !!rec;
}

function meta() {
    if (!rec) return null;
    const last = rec.frames.length ? rec.frames[rec.frames.length - 1].t : 0;
    return {
        v:             1,
        startedAt:     rec.startedAt,
        note:          rec.note,
        lang:          rec.lang,
        modVersion:    rec.modVersion,
        schemaVersion: rec.schemaVersion,
        saveName:      rec.saveName,
        serverVersion: pkg.version,
        frames:        rec.frames.length,
        totalSeen:     rec.total,
        durationMs:    last,
        truncated:     rec.truncated,
        capFrames:     CAP_FRAMES,
        clientErrors:  rec.clientLines.length,
        clientSettings: rec.clientSettings,
    };
}

function flush() {
    if (!rec) return;
    rec.sinceFlush = 0;
    // Interleave data frames, client-log lines and markers by their relative
    // timestamp so a human reading the file sees everything in context.
    const entries = rec.frames.concat(rec.clientLines, rec.markerLines).sort((a, b) => a.t - b.t);
    const lines = [JSON.stringify({ meta: meta() })];
    for (const e of entries) lines.push(JSON.stringify(e));
    try {
        fs.writeFileSync(rec.file, lines.join('\n') + '\n');
    } catch (e) {
        log.error('rec', `flush selhal: ${e.message}`);
    }
}

function start(opts = {}) {
    if (rec) stop();   // implicitly close any prior recording
    const startedAt = new Date();
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
    const name  = `rec-${stamp}.jsonl`;
    fs.mkdirSync(recordingsDir(), { recursive: true });
    rec = {
        name,
        file:        path.join(recordingsDir(), name),
        startedAtMs: startedAt.getTime(),
        startedAt:   startedAt.toISOString(),
        note:        String(opts.note || '').slice(0, 500),
        lang:        opts.lang || null,
        modVersion:    null,
        schemaVersion: null,
        saveName:      null,
        frames:      [],   // ring of { t, payload }
        total:       0,    // total frames seen (including dropped by the ring)
        truncated:   false,
        sinceFlush:  0,
        clientLines:    [],   // ring of { t, client } (JS errors etc.)
        markerLines:    [],   // [{ t, marker:{label,clientTime} }] — flagged moments
        clientSettings: null, // last settings/env snapshot from the client
    };
    flush();               // write meta immediately so the file exists
    prune();
    log.add('rec', `nahrávání spuštěno → ${name}`);
    return { name, file: rec.file };
}

function appendFrame(payload) {
    if (!rec || !payload || typeof payload !== 'object') return;
    // Lift mod/save identity off the first frame that carries it.
    if (rec.modVersion    == null && payload.modVersion    != null) rec.modVersion    = payload.modVersion;
    if (rec.schemaVersion == null && payload.schemaVersion != null) rec.schemaVersion = payload.schemaVersion;
    if (rec.saveName      == null && payload.saveMeta && payload.saveMeta.name) rec.saveName = payload.saveMeta.name;

    rec.frames.push({ t: Date.now() - rec.startedAtMs, payload });
    rec.total++;
    if (rec.frames.length > CAP_FRAMES) {
        rec.frames.shift();
        rec.truncated = true;
    }
    if (++rec.sinceFlush >= FLUSH_EVERY) flush();
}

// Ingest a client-log post (public/diag.js): JS errors and/or a settings
// snapshot. Always feeds the global recent-errors ring; folds into the active
// recording when one is running. `body` = { errors?: [...], settings?: {...} }.
function noteClient(body) {
    if (!body || typeof body !== 'object') return;
    const errors = Array.isArray(body.errors) ? body.errors : [];

    for (const err of errors) {
        if (!err || typeof err !== 'object') continue;
        err._rxTs = Date.now();
        recentClient.push(err);
        while (recentClient.length > CAP_RECENT) recentClient.shift();
        if (rec) {
            rec.clientLines.push({ t: Date.now() - rec.startedAtMs, client: err });
            while (rec.clientLines.length > CAP_CLIENT) rec.clientLines.shift();
        }
    }

    if (body.settings && typeof body.settings === 'object') {
        lastClientSettings = body.settings;
        if (rec) rec.clientSettings = body.settings;
    }

    if (rec && (errors.length || body.settings)) flush();
}

// Flag the current moment. Goes into the active recording (if any) and always
// into the rolling-marker ring so a later retroactive save picks it up.
function addMarker(label) {
    const now = Date.now();
    const m = { label: String(label || '').slice(0, 120), clientTime: new Date(now).toISOString() };
    rollingMarkers.push({ ts: now, label: m.label });
    while (rollingMarkers.length > CAP_MARKS) rollingMarkers.shift();
    if (rec) {
        rec.markerLines.push({ t: now - rec.startedAtMs, marker: m });
        flush();
    }
    return { ok: true, recording: !!rec };
}

function stop() {
    if (!rec) return null;
    flush();
    const m = meta();
    const result = {
        name:       rec.name,
        file:       rec.file,
        frames:     m.frames,
        totalSeen:  m.totalSeen,
        durationMs: m.durationMs,
        truncated:  m.truncated,
    };
    log.add('rec', `nahrávání zastaveno → ${rec.name} (${result.frames} rámců, ${(result.durationMs / 1000).toFixed(0)}s${result.truncated ? ', oříznuto na poslední ' + CAP_FRAMES : ''})`);
    rec = null;
    return result;
}

function status() {
    if (!rec) return { active: false, recentClientErrors: recentClient.length, buffered: rolling.length };
    const m = meta();
    return {
        active:       true,
        name:         rec.name,
        note:         rec.note,
        startedAt:    rec.startedAt,
        frames:       m.frames,
        durationMs:   m.durationMs,
        truncated:    m.truncated,
        clientErrors: m.clientErrors,
        buffered:     rolling.length,
    };
}

// Write the rolling buffer to a recording file — a retroactive capture of the
// last CAP_ROLL frames plus any recent client errors + the latest settings.
function saveRolling(opts = {}) {
    if (!rolling.length) return null;
    const firstTs = rolling[0].ts;
    const lastTs  = rolling[rolling.length - 1].ts;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name  = `rec-buffer-${stamp}.jsonl`;

    let modVersion = null, schemaVersion = null, saveName = null;
    for (const e of rolling) {
        const p = e.payload;
        if (modVersion    == null && p.modVersion    != null) modVersion    = p.modVersion;
        if (schemaVersion == null && p.schemaVersion != null) schemaVersion = p.schemaVersion;
        if (saveName      == null && p.saveMeta && p.saveMeta.name) saveName = p.saveMeta.name;
    }
    const clientLines = recentClient
        .filter(e => e._rxTs >= firstTs && e._rxTs <= lastTs + 1000)
        .map(e => ({ t: Math.max(0, e._rxTs - firstTs), client: e }));
    const markerLines = rollingMarkers
        .filter(m => m.ts >= firstTs && m.ts <= lastTs + 1000)
        .map(m => ({ t: Math.max(0, m.ts - firstTs), marker: { label: m.label, clientTime: new Date(m.ts).toISOString() } }));

    const metaObj = {
        v: 1,
        startedAt:     new Date(firstTs).toISOString(),
        note:          String(opts.note || '').slice(0, 500),
        lang:          opts.lang || null,
        modVersion, schemaVersion, saveName,
        serverVersion: pkg.version,
        frames:        rolling.length,
        totalSeen:     rolling.length,
        durationMs:    lastTs - firstTs,
        truncated:     rolling.length >= CAP_ROLL,
        capFrames:     CAP_ROLL,
        retroactive:   true,
        clientErrors:  clientLines.length,
        clientSettings: lastClientSettings,
    };
    const entries = rolling
        .map(e => ({ t: Math.max(0, e.ts - firstTs), payload: e.payload }))
        .concat(clientLines, markerLines)
        .sort((a, b) => a.t - b.t);
    const lines = [JSON.stringify({ meta: metaObj })].concat(entries.map(x => JSON.stringify(x)));
    try {
        fs.mkdirSync(recordingsDir(), { recursive: true });
        fs.writeFileSync(path.join(recordingsDir(), name), lines.join('\n') + '\n');
        prune();
        log.add('rec', `zpětně uložen záznam ${name} (${rolling.length} rámců, ${clientLines.length} chyb)`);
        return { name, frames: rolling.length, clientErrors: clientLines.length };
    } catch (e) {
        log.error('rec', `save-buffer selhal: ${e.message}`);
        return null;
    }
}

// Read just the first line of a recording file → its meta object (or null).
function readMeta(filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(64 * 1024);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        const text = buf.slice(0, n).toString('utf8');
        const nl = text.indexOf('\n');
        const firstLine = nl >= 0 ? text.slice(0, nl) : text;
        const obj = JSON.parse(firstLine);
        return obj.meta || null;
    } catch (_) {
        return null;
    } finally {
        if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
    }
}

// List recordings (newest first), reading each file's meta line.
function list() {
    let files;
    try { files = fs.readdirSync(recordingsDir()); } catch (_) { return []; }
    const out = [];
    for (const f of files) {
        if (!NAME_RE.test(f)) continue;
        const fp = path.join(recordingsDir(), f);
        let st; try { st = fs.statSync(fp); } catch (_) { continue; }
        const m = readMeta(fp);
        out.push({
            name:         f,
            startedAt:    m ? m.startedAt    : null,
            note:         m ? m.note         : '',
            frames:       m ? m.frames       : null,
            durationMs:   m ? m.durationMs   : null,
            clientErrors: m ? m.clientErrors : null,
            modVersion:   m ? m.modVersion   : null,
            saveName:     m ? m.saveName     : null,
            retroactive:  m ? !!m.retroactive : false,
            sizeBytes:    st.size,
            active:       !!(rec && rec.name === f),
        });
    }
    out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return out;
}

// Resolve a recording name to an absolute path, guarding against traversal.
function resolve(name) {
    if (!NAME_RE.test(String(name || ''))) return null;
    return path.join(recordingsDir(), name);
}

// Keep only the newest `max` recordings on disk (never the active one).
function prune(max) {
    const cap = max || Math.max(1, parseInt(process.env.DASHBOARD_REC_MAX_FILES || '30', 10));
    let files;
    try { files = fs.readdirSync(recordingsDir()).filter(f => NAME_RE.test(f)); } catch (_) { return; }
    if (files.length <= cap) return;
    const ranked = files
        .map(f => { let m = 0; try { m = fs.statSync(path.join(recordingsDir(), f)).mtimeMs; } catch (_) {} return { f, m }; })
        .sort((a, b) => b.m - a.m);   // newest first
    for (const { f } of ranked.slice(cap)) {
        if (rec && rec.name === f) continue;
        try { fs.unlinkSync(path.join(recordingsDir(), f)); } catch (_) {}
    }
}

function remove(name) {
    const fp = resolve(name);
    if (!fp) return false;
    if (rec && rec.name === name) return false;   // don't delete the live one
    try { fs.unlinkSync(fp); return true; } catch (_) { return false; }
}

module.exports = {
    start, stop, appendFrame, observe, saveRolling, noteClient, addMarker,
    status, list, resolve, remove, prune,
    isActive, recordingsDir, readMeta,
};
