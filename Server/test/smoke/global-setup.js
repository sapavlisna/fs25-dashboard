// Playwright globalSetup — wipe the smoke sandbox before each run so a stale
// scenario pin (mock-scenario.txt) or leftover dashboard_data.json from a
// previous run can't leak into the next (this bit us once: a pinned
// 'plan-3-years' scenario hid the priceForecast and broke an unrelated test).
const fs = require('fs');
const path = require('path');
const { SANDBOX } = require('./sandbox-env');

module.exports = async () => {
    // SANDBOX is per-shard when SMOKE_SANDBOX is set, so a sharded run wipes only
    // its own directory and never the sibling shards'.
    // Wipe the CONTENTS, not the directory: Playwright starts the webServers
    // BEFORE globalSetup, so the server's chokidar watch is already armed on
    // this path. Removing the directory under it left the watch pointing at a
    // dead inode, so no payload ever reached the browser (KPIs stuck on '—').
    fs.mkdirSync(SANDBOX, { recursive: true });
    for (const entry of fs.readdirSync(SANDBOX)) {
        try {
            fs.rmSync(path.join(SANDBOX, entry), { recursive: true, force: true });
        } catch (_) { /* held open by a previous run — the next write overwrites it */ }
    }
};
