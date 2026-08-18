// Single source of truth for the smoke sandbox: which port the server listens on
// and which directory holds its throwaway data.
//
// Both come from the environment so that a SHARDED run can give every shard its
// own pair. That is what keeps the suite's core invariant intact while still
// running in parallel: one sandbox server per Playwright process, one worker
// inside it. Shards are parallel to each other, never within.
//
// Defaults reproduce the original single-process setup exactly (port 3099,
// .tmp/smoke), so `npm run test:all` behaves as before with no env set.
//
// Scope splits the suite: the state/ subtree is ~14 specs of exhaustive state
// coverage, the root is 22 specs of smoke. Running both under one command is
// what turned a "quick check" into a 35-minute wait.

const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const PORT    = Number(process.env.SMOKE_PORT || 3099);
const SANDBOX = process.env.SMOKE_SANDBOX || path.join(REPO_ROOT, '.tmp', 'smoke');

// 'smoke' = root specs minus the load-sensitive ones · 'visual' = only those
// (always sequential) · 'state' = state/ subtree · 'all' = everything
const SCOPE = process.env.SMOKE_SCOPE || 'all';

// Specs that assert on RENDERED LAYOUT and therefore cannot share a machine
// with parallel shards. Measured 2026-07-26, same machine, same code:
//
//   sequential : scenarios + section-cfg      → 37/37 pass
//   4 shards   : the same specs               → 37 fail (2-3 % pixel diff)
//   4 shards + retry                          → 37 fail again, run 8.1 → 12.4 min
//
// The retry proves it is not random flakiness: the load lasts the whole run, so
// the second attempt is just as starved as the first. The dashboard places
// sections with a JS greedy column balancer whose outcome depends on when data
// arrives, so a saturated CPU reshuffles the layout deterministically.
//
// These run sequentially (scope 'visual'); everything else can be sharded.
const LOAD_SENSITIVE = [
    '**/scenarios.spec.js',    // full-page screenshot baselines
    '**/section-cfg.spec.js',  // asserts on rendered section groups
];

// Retries default to 0 — a sequential run is the authoritative verdict.
//
// A sharded run sets 1, because the screenshot tests in scenarios.spec.js are
// timing-sensitive: the dashboard lays sections out with a JS greedy column
// balancer, and which column a section lands in depends on when its data
// arrives. Under load (four Chromium instances, possibly a running game) the
// layout can settle differently and the same test fails on a 2-3 % pixel diff,
// then passes on its own moments later — observed both ways in one session.
// One retry absorbs that without hiding a real regression, which fails twice.
const RETRIES = Number(process.env.SMOKE_RETRIES || 0);

// animals-flash.spec.js runs under its own harness (playwright.flash.config.js,
// port 3098 + flash-global-setup.js) — under this config it lacks
// __FLASH_MOCK_FILE and fails instantly.
// capture-help-screenshots.spec.js WRITES public/help/*.png — the images the
// help page ships. Under a normal run it fired with whatever mock scenario the
// previous spec had pinned (empty-farm, low-fuel…), so a routine smoke run
// silently replaced the published screenshots with an empty farm. It only ever
// belonged in a deliberate refresh: scope 'help' (npm run capture:help).
const CAPTURE_ONLY = '**/capture-help-screenshots.spec.js';

const ALWAYS_IGNORE = ['**/animals-flash.spec.js', CAPTURE_ONLY];

function testFilters(scope = SCOPE) {
    // testIgnore, not a narrower testMatch: Playwright's '*' crosses path
    // separators, so '*.spec.js' still picks up state/ — verified with --list
    // (it reported all 657 tests instead of the root 205).
    if (scope === 'smoke') {
        return {
            testMatch: '**/*.spec.js',
            testIgnore: [...ALWAYS_IGNORE, '**/state/**', ...LOAD_SENSITIVE],
        };
    }
    if (scope === 'visual') {
        return { testMatch: LOAD_SENSITIVE, testIgnore: ALWAYS_IGNORE };
    }
    // 'root' = every root spec including the load-sensitive ones, i.e. what the
    // suite looked like before the smoke/visual split. Kept for A/B checks: the
    // mock scenarios are global state, so removing specs from a run changes what
    // the remaining ones inherit.
    if (scope === 'root') {
        return { testMatch: '**/*.spec.js', testIgnore: [...ALWAYS_IGNORE, '**/state/**'] };
    }
    if (scope === 'state') {
        return { testMatch: 'state/**/*.spec.js', testIgnore: ALWAYS_IGNORE };
    }
    // The one scope that runs the capture spec — and only it.
    if (scope === 'help') {
        return { testMatch: CAPTURE_ONLY, testIgnore: [] };
    }
    return { testMatch: '**/*.spec.js', testIgnore: ALWAYS_IGNORE };
}

module.exports = {
    REPO_ROOT,
    PORT,
    SANDBOX,
    SCOPE,
    RETRIES,
    MOCK_FILE: path.join(SANDBOX, 'dashboard_data.json'),
    DATA_DIR:  path.join(SANDBOX, 'data'),
    baseURL:   `http://localhost:${PORT}`,
    wsURL:     `ws://localhost:${PORT}`,
    testFilters,
};
