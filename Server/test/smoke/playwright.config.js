// Playwright config for the Dashboard smoke suite.
// Spawns mock-data + the dashboard server on port 3099 with an isolated
// sandbox data dir under .tmp/smoke so the real history is never touched.

const path = require('path');
const { defineConfig } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SANDBOX  = path.join(REPO_ROOT, '.tmp', 'smoke');
const MOCK_FILE = path.join(SANDBOX, 'dashboard_data.json');
const DATA_DIR  = path.join(SANDBOX, 'data');
const PORT = 3099;

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '**/*.spec.js',
    timeout: 30_000,
    fullyParallel: false,         // single server — one test at a time
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: [
        {
            // Mock generator — writes dashboard_data.json every 5 s.
            command: `node "${path.join(REPO_ROOT, 'src/Dashboard/Server/scripts/mock-data.js')}" "${MOCK_FILE}"`,
            url: undefined,
            reuseExistingServer: false,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 10_000,
        },
        {
            // Dashboard server — reads sandbox mock file, writes sandbox history.
            command: `node "${path.join(REPO_ROOT, 'src/Dashboard/Server/index.js')}"`,
            url: `http://localhost:${PORT}`,
            reuseExistingServer: false,
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 15_000,
            env: {
                DASHBOARD_PORT: String(PORT),
                DASHBOARD_DATA_FILE: MOCK_FILE,
                DASHBOARD_DATA_DIR: DATA_DIR,
            },
        },
    ],
});
