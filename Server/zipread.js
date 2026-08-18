// zipread.js — minimal read-only ZIP access for mod inspection.
//
// Why not shell out like mapOverview.js does? That spawns PowerShell per
// archive, which is fine for the one map ZIP it opens but not for a mods folder
// with 300+ entries. Reading in-process is milliseconds, and `zlib` is a Node
// built-in, so this still adds no dependency.
//
// It reads by file descriptor rather than slurping the archive, because a mods
// folder is mostly enormous files with a few kilobytes of interest: measured on
// this machine, 311 mods totalling 13 GB. Reading whole archives took 29 s and
// briefly held a ~200 MB buffer per mod; seeking to the central directory and
// pulling out just modDesc.xml touches a few hundred KB per archive instead.
//
// Scope is deliberately narrow: list entries, extract small members by name.
// No ZIP64, no encryption, no streaming — a modDesc.xml is a few KB.

const fs   = require('fs');
const zlib = require('zlib');

const SIG_EOCD    = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL   = 0x04034b50;

const EOCD_SCAN = 66_000;      // max comment length (64 KB) + record size

function readAt(fd, position, length) {
    if (length <= 0) return Buffer.alloc(0);
    const buf = Buffer.alloc(length);
    const got = fs.readSync(fd, buf, 0, length, position);
    return got === length ? buf : buf.subarray(0, got);
}

// The end-of-central-directory record sits at the very end of the file, after a
// comment of up to 64 KB. Scan backwards over that window for its signature.
function findEocd(buf) {
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === SIG_EOCD) return i;
    }
    return -1;
}

function parseCentralDirectory(buf, count) {
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= buf.length; i++) {
        if (buf.readUInt32LE(p) !== SIG_CENTRAL) break;
        const method     = buf.readUInt16LE(p + 10);
        const compressed = buf.readUInt32LE(p + 20);
        const size       = buf.readUInt32LE(p + 24);
        const nameLen    = buf.readUInt16LE(p + 28);
        const extraLen   = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localOff   = buf.readUInt32LE(p + 42);
        const name       = buf.toString('utf8', p + 46, p + 46 + nameLen);

        if (!name.endsWith('/')) {
            out.push({ name, method, compressedSize: compressed, size, localOffset: localOff });
        }
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

/**
 * Open an archive. Returns { entries, read(name), close() } or null when the
 * file isn't a readable ZIP.
 *
 * IMPORTANT: call close() — this holds an OS file descriptor. Callers that skip
 * it will exhaust the process's descriptor limit somewhere around mod 200.
 */
function open(filePath) {
    let fd, size;
    try {
        fd = fs.openSync(filePath, 'r');
        size = fs.fstatSync(fd).size;
    } catch (_) {
        if (fd != null) { try { fs.closeSync(fd); } catch (_) {} }
        return null;
    }

    const bail = () => { try { fs.closeSync(fd); } catch (_) {} return null; };

    const tailLen = Math.min(size, EOCD_SCAN);
    const tail = readAt(fd, size - tailLen, tailLen);
    const eocdAt = findEocd(tail);
    if (eocdAt < 0) return bail();

    const count     = tail.readUInt16LE(eocdAt + 10);
    const dirSize   = tail.readUInt32LE(eocdAt + 12);
    const dirOffset = tail.readUInt32LE(eocdAt + 16);
    // 0xffffffff in either field means ZIP64, which mod archives don't use and
    // this reader doesn't implement.
    if (dirOffset >= size || dirSize > size) return bail();

    const entries = parseCentralDirectory(readAt(fd, dirOffset, dirSize), count);
    const byName = new Map(entries.map(e => [e.name.toLowerCase(), e]));

    return {
        entries,

        // Extract one entry's bytes. The central directory's sizes are
        // authoritative, but the DATA starts after the LOCAL header — whose
        // name/extra lengths differ from the central copy often enough that
        // reusing them silently yields garbage.
        read(name) {
            const e = byName.get(String(name).toLowerCase());
            if (!e) return null;
            const head = readAt(fd, e.localOffset, 30);
            if (head.length < 30 || head.readUInt32LE(0) !== SIG_LOCAL) return null;
            const start = e.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
            const raw = readAt(fd, start, e.compressedSize);
            if (raw.length !== e.compressedSize) return null;

            if (e.method === 0) return raw;                    // stored
            if (e.method === 8) {
                try { return zlib.inflateRawSync(raw); } catch (_) { return null; }
            }
            return null;   // bzip2/lzma — vanishingly rare in mod ZIPs
        },

        close() { try { fs.closeSync(fd); } catch (_) {} },
    };
}

module.exports = { open };
