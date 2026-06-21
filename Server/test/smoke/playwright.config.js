// Playwright config for the Dashboard smoke suite.
// Spawns mock-data + the dashboard server on port 3099 with an isolated
// sandbox data dir under .tmp/smoke so the real history is never touched.
//
// Screenshot baselines are stored in test/smoke/screenshots/.
// Run with --update-snapshots to regenerate baselines.
// Visual diff threshold: 0.5 % (maxDiffPixelRatio: 0.005).

const path = require('path');
const { defineConfig } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SANDBOX   = path.join(REPO_ROOT, '.tmp', 'smoke');
const MOCK_FILE = path.join(SANDBOX, 'dashboard_data.json');
const DATA_DIR  = path.join(SANDBOX, 'data');
const PORT = 3099;

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '**/*.spec.js',
    // animals-flash.spec.js runs under its own harness (playwright.flash.config.js,
    // port 3098 + flash-global-setup.js) — under this config it lacks
    // __FLASH_MOCK_FILE and fails instantly.
    testIgnore: '**/animals-flash.spec.js',
    globalSetup: require.resolve('./global-setup.js'),
    timeout: 45_000,
    fullyParallel: false,         // single server — one test at a time
    workers: 1,
    reporter: [['list']],

    // Screenshot diff settings — referenced by scenarios.spec.js
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.005,   // 0.5 % pixel difference tolerance
            animations: 'disabled',
        },
    },

    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Viewport consistent across scenario screenshots
        viewport: { width: 1440, height: 900 },
    },

    // Screenshots dir for toHaveScreenshot() baselines
    snapshotDir: path.join(__dirname, 'screenshots'),

    webServer: [
        {
            // Mock generator — writes dashboard_data.json every 5 s.
            // Default scenario is 'default'; Playwright tests switch via POST /mock/scenario.
            command: `node "${path.join(REPO_ROOT, 'src/Dashboard/Server/scripts/mock-data.js')}" "${MOCK_FILE}"`,
            url: undefined,
            reuseExistingServer: false,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 10_000,
        },
        {
            // Dashboard server — reads sandbox mock file, writes sandbox history.
            // DASHBOARD_MOCK=1 enables POST /mock/scenario endpoint.
            command: `node "${path.join(REPO_ROOT, 'src/Dashboard/Server/index.js')}"`,
            url: `http://localhost:${PORT}`,
            reuseExistingServer: false,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 15_000,
            env: {
                DASHBOARD_PORT:      String(PORT),
                DASHBOARD_DATA_FILE: MOCK_FILE,
                DASHBOARD_DATA_DIR:  DATA_DIR,
                DASHBOARD_MOCK:      '1',
                DASHBOARD_OPEN_BROWSER: 'false',
                FS25_DOCS_DIR:       SANDBOX,
            },
        },
    ],
});
