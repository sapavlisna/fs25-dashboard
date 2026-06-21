// logger.js — minimal stdout logger for the relay (mirrors Server/logger.js so
// log lines look the same). Standalone on purpose: the relay Docker image copies
// only Relay/ + public/, not Server/, so it can't share the server's logger.
//
// LOG_LEVEL=quiet|info|debug controls verbosity (same as the server).

const LEVELS = { quiet: 0, info: 1, debug: 2 };
const LEVEL  = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

const USE_COLOR = !process.env.NO_COLOR && process.stdout.isTTY;
const C = USE_COLOR ? {
    reset:  '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m',
    yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m', gray: '\x1b[90m',
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

const log = {
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
    add  (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.green,  '+', cat, msg); },
    drop (cat, msg) { if (LEVEL >= LEVELS.info)  emit(process.stdout, C.dim,    '−', cat, msg); },
    warn (cat, msg) {                            emit(process.stderr, C.yellow, '⚠', cat, msg); },
    error(cat, msg) {                            emit(process.stderr, C.red,    '✗', cat, msg); },
    debug(cat, msg) { if (LEVEL >= LEVELS.debug) emit(process.stdout, C.gray,   '·', cat, msg); },
};

module.exports = log;
