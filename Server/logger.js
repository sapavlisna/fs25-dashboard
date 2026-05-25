// logger.js — single source of truth for everything the server prints.
//
// Goals:
//   * Every line starts with HH:MM:SS so you can reconstruct what happened.
//   * Every line carries an icon that tells you the *kind* of event at a
//     glance (routine tick, persisted write, client in/out, warning, …).
//   * Verbosity is controlled by LOG_LEVEL=quiet|info|debug
//       quiet  — only warnings and errors
//       info   — default; meaningful events + a 1-minute summary
//       debug  — info + every tick, every raw watcher fire, every WS event
//   * Colors are opt-out (set NO_COLOR=1 or pipe stdout to a file).
//
// API:
//   log.start(line)     — boxed banner line (use on boot)
//   log.info(cat, msg)  — ⓘ blue informational
//   log.ok(cat, msg)    — ✓ green success / data arrived
//   log.tick(cat, msg)  — • dim per-tick line (suppressed at quiet)
//   log.write(cat, msg) — ▶ green persisted-to-disk
//   log.add(cat, msg)   — + green client / resource added
//   log.drop(cat, msg)  — − dim client / resource removed
//   log.warn(cat, msg)  — ⚠ yellow recoverable problem
//   log.error(cat, msg) — ✗ red unrecoverable / parse fail / unhandled
//   log.debug(cat, msg) — gray, shown only at LOG_LEVEL=debug

const LEVELS = { quiet: 0, info: 1, debug: 2 };
const LEVEL  = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

// ANSI escapes; honoured by every modern Windows terminal + most CI logs.
// Disabled when output is piped or NO_COLOR is set.
const USE_COLOR = !process.env.NO_COLOR && process.stdout.isTTY;
const C = USE_COLOR ? {
    reset:  '\x1b[0m',
    dim:    '\x1b[2m',
    red:    '\x1b[31m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    blue:   '\x1b[34m',
    cyan:   '\x1b[36m',
    gray:   '\x1b[90m',
} : Object.fromEntries(['reset','dim','red','green','yellow','blue','cyan','gray'].map(k => [k, '']));

function ts() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
}

function emit(stream, color, icon, cat, msg) {
    const prefix = cat ? `${C.gray}${cat}${C.reset} ` : '';
    stream.write(`${C.gray}${ts()}${C.reset}  ${color}${icon}${C.reset}  ${prefix}${msg}\n`);
}

// ─── Public API ─────────────────────────────────────────────────────────

const log = {
    // Boxed startup banner. Pass an array of lines; first line is title.
    banner(lines) {
        const w = Math.max(...lines.map(l => l.length), 50);
        const top    = '┌' + '─'.repeat(w + 2) + '┐';
        const bottom = '└' + '─'.repeat(w + 2) + '┘';
        process.stdout.write(`\n${C.cyan}${top}${C.reset}\n`);
        for (const line of lines) {
            process.stdout.write(`${C.cyan}│${C.reset} ${line.padEnd(w)} ${C.cyan}│${C.reset}\n`);
        }
        process.stdout.write(`${C.cyan}${bottom}${C.reset}\n\n`);
    },

    info (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.blue,   'ⓘ', cat, msg); },
    ok   (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.green,  '✓', cat, msg); },
    tick (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.dim,    '•', cat, msg); },
    write(cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.green,  '▶', cat, msg); },
    add  (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.green,  '+', cat, msg); },
    drop (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.dim,    '−', cat, msg); },
    warn (cat, msg) {                            emit(process.stderr, C.yellow, '⚠', cat, msg); },
    error(cat, msg) {                            emit(process.stderr, C.red,    '✗', cat, msg); },
    debug(cat, msg) { if (LEVEL >= LEVELS.debug) emit(process.stdout, C.gray,   '·', cat, msg); },
};

module.exports = log;
