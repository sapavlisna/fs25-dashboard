// cloudAuthStore.js — local-only persistence of the cloud-relay password.
//
// Lives in a separate JSON file from dashboard-state so we never accidentally
// expose the hash through the device-sync surface (`/api/dashboard-state`).
// Plaintext passwords never reach this module — the caller passes them once
// to `set()`, we hash + salt them, store only the digest, and immediately
// drop the plaintext reference.
//
// Storage shape:
//   { enabled: bool, passwordHash: string|null, salt: string|null, version: int }

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const SALT_BYTES = 16;

function hash(plaintext, saltHex) {
    return crypto.createHmac('sha256', Buffer.from(saltHex, 'hex'))
                 .update(plaintext, 'utf8').digest('hex');
}

class CloudAuthStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = this.#load();
    }

    #load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                return { enabled: false, passwordHash: null, salt: null, version: 0 };
            }
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            return {
                enabled:      !!raw.enabled,
                passwordHash: raw.passwordHash || null,
                salt:         raw.salt         || null,
                version:      Number.isFinite(raw.version) ? raw.version : 0,
            };
        } catch (e) {
            console.warn('[CloudAuth] load error:', e.message);
            return { enabled: false, passwordHash: null, salt: null, version: 0 };
        }
    }

    #persist() {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const tmp = this.filePath + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
            fs.renameSync(tmp, this.filePath);
        } catch (e) {
            console.warn('[CloudAuth] persist error:', e.message);
        }
    }

    /**
     * Returns the config the cloud relay needs — hash+salt+version. Never
     * includes plaintext (none is stored). Returned `passwordHash` is null
     * when auth is disabled, which the cloud interprets as open mode.
     */
    get() {
        return this.data.enabled
            ? { passwordHash: this.data.passwordHash, salt: this.data.salt, version: this.data.version }
            : { passwordHash: null,                   salt: null,           version: this.data.version };
    }

    /**
     * Update the password. `plaintext` is consumed locally and immediately
     * forgotten — the persisted record holds only HMAC-SHA-256(salt, plaintext).
     * Pass enabled=false to disable auth (clears hash, bumps version).
     */
    set({ enabled, plaintext }) {
        let next;
        if (!enabled || !plaintext) {
            next = { enabled: false, passwordHash: null, salt: null, version: this.data.version + 1 };
        } else {
            const saltHex = crypto.randomBytes(SALT_BYTES).toString('hex');
            const h       = hash(plaintext, saltHex);
            next = { enabled: true, passwordHash: h, salt: saltHex, version: this.data.version + 1 };
        }

        // Drop the plaintext reference. JS strings are immutable so we can't
        // overwrite memory bytes, but at least ensure no closure keeps the
        // value alive past this function.
        plaintext = null;

        this.data = next;
        this.#persist();
        return this.get();
    }
}

module.exports = { CloudAuthStore };
