// Playwright config for the Dashboard smoke suite.
// Spawns mock-data + the dashboard server on an isolated port with a throwaway
// sandbox data dir so the real history is never touched.
//
// Port, sandbox dir and scope come from sandbox-env.js (SMOKE_PORT /
// SMOKE_SANDBOX / SMOKE_SCOPE). With no env set this is the original behaviour:
// port 3099, .tmp/smoke, every spec. A sharded run (scripts/run-sharded.js)
// hands each shard its own port + sandbox — that is what lets shards run in
// parallel while each one still has a single server and a single worker.
//
// Screenshot baselines are stored in test/smoke/screenshots/.
// Run with --update-snapshots to regenerate baselines.
// Visual diff threshold: 0.5 % (maxDiffPixelRatio: 0.005).

const path = require('path');
const { defineConfig } = require('@playwright/test');
const env = require('./sandbox-env');

const { PORT, SANDBOX, MOCK_FILE, DATA_DIR, REPO_ROOT, baseURL, RETRIES } = env;
const { testMatch, testIgnore } = env.testFilters();

module.exports = defineConfig({
    testDir: __dirname,
    testMatch,
    testIgnore,
    globalSetup: require.resolve('./global-setup.js'),
    timeout: 45_000,
    // Still one test at a time: a single sandbox server with stateful mock
    // scenarios cannot be shared by concurrent workers. Parallelism comes from
    // running several shards, each with its own server.
    fullyParallel: false,
    workers: 1,
    retries: RETRIES,
    reporter: [['list']],

    // Screenshot diff settings — referenced by scenarios.spec.js
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.005,   // 0.5 % pixel difference tolerance
            animations: 'disabled',
        },
    },

    use: {
        baseURL,
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
            url: baseURL,
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
