// Playwright globalSetup — wipe the smoke sandbox before each run so a stale
// scenario pin (mock-scenario.txt) or leftover dashboard_data.json from a
// previous run can't leak into the next (this bit us once: a pinned
// 'plan-3-years' scenario hid the priceForecast and broke an unrelated test).
const fs   = require('fs');
const path = require('path');

module.exports = async () => {
    const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
    const SANDBOX   = path.join(REPO_ROOT, '.tmp', 'smoke');
    try {
        fs.rmSync(SANDBOX, { recursive: true, force: true });
    } catch (_) { /* first run — nothing to clean */ }
    fs.mkdirSync(SANDBOX, { recursive: true });
};
