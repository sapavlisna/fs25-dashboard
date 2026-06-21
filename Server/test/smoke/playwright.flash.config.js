// Playwright config for animal-flash isolation tests.
// Starts ONLY the dashboard server (no mock-data.js) on port 3098.
// Tests write dashboard_data.json directly to control exactly which
// value changes between ticks.

const path = require('path');
const { defineConfig } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SANDBOX   = path.join(REPO_ROOT, '.tmp', 'flash-test');
const MOCK_FILE = path.join(SANDBOX, 'dashboard_data.json');
const DATA_DIR  = path.join(SANDBOX, 'data');
const PORT = 3098;

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: 'animals-flash.spec.js',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],

    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        viewport: { width: 1440, height: 900 },
    },

    webServer: {
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
            DASHBOARD_OPEN_BROWSER: 'false',
        },
    },

    // Expose paths to tests via env
    globalSetup: require.resolve('./flash-global-setup.js'),
});

module.exports.MOCK_FILE = MOCK_FILE;
module.exports.SANDBOX   = SANDBOX;
