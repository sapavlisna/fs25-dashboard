#!/usr/bin/env node
// Runs the Playwright smoke suite as N parallel shards.
//
// Why shards and not `workers: N`: every test drives ONE sandbox server whose
// mock scenario is global state (POST /mock/scenario, mock-scenario.txt). Two
// workers inside one process would overwrite each other's scenario mid-test.
// A shard is a whole separate process with its OWN server, port and sandbox
// dir, so the "one server, one worker" invariant survives while shards run
// side by side.
//
// Usage:
//   node scripts/run-sharded.js                  # 4 shards, scope=all
//   node scripts/run-sharded.js --shards 3       # 3 shards
//   node scripts/run-sharded.js --scope smoke    # root specs only
//   node scripts/run-sharded.js --scope state    # state/ subtree only
//   node scripts/run-sharded.js -- --grep @slow  # extra args go to Playwright
//
// Ports start at BASE_PORT and step by one per shard; 3098 is reserved by the
// flash harness, so the default base sits above it.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const CONFIG = path.join(__dirname, '..', 'test', 'smoke', 'playwright.config.js');
const BASE_PORT = Number(process.env.SMOKE_BASE_PORT || 3200);

function parseArgs(argv) {
    const out = { shards: 4, scope: 'all', passthrough: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--') { out.passthrough.push(...argv.slice(i + 1)); break; }
        else if (a === '--shards' || a === '-n') out.shards = Number(argv[++i]);
        else if (a === '--scope' || a === '-s') out.scope = argv[++i];
        else out.passthrough.push(a);
    }
    if (!Number.isInteger(out.shards) || out.shards < 1) {
        console.error(`Invalid --shards: ${out.shards}`);
        process.exit(2);
    }
    if (!['all', 'smoke', 'visual', 'state', 'root', 'help'].includes(out.scope)) {
        console.error(`Invalid --scope: ${out.scope} (expected all|smoke|visual|state|root|help)`);
        process.exit(2);
    }
    return out;
}

function runShard(index, total, scope, passthrough) {
    const port = BASE_PORT + index - 1;
    const sandbox = path.join(REPO_ROOT, '.tmp', `smoke-shard${index}`);
    const label = `shard ${index}/${total}`;

    const args = [
        'playwright', 'test',
        `--config=${CONFIG}`,
        `--shard=${index}/${total}`,
        '--reporter=list',
        ...passthrough,
    ];

    return new Promise(resolve => {
        const child = spawn('npx', args, {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                SMOKE_PORT: String(port),
                SMOKE_SANDBOX: sandbox,
                SMOKE_SCOPE: scope,
                // Playwright colour codes would interleave badly across shards.
                FORCE_COLOR: '0',
            },
            shell: process.platform === 'win32',
        });

        const lines = [];
        const collect = buf => { lines.push(buf.toString()); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);

        child.on('close', code => {
            const output = lines.join('');
            // The summary lines are what matters; per-test chatter from four
            // shards at once is unreadable, so only those are surfaced live.
            const summary = output.split('\n')
                .filter(l => /\d+ (passed|failed|skipped|flaky)|✘|Error:|Timed out/.test(l))
                .join('\n');
            console.log(`\n──── ${label} (port ${port}) exit=${code} ────`);
            console.log(summary.trim() || '(no summary lines)');
            resolve({ index, port, code, output });
        });
    });
}

(async () => {
    const { shards, scope, passthrough } = parseArgs(process.argv.slice(2));
    const started = Date.now();

    console.log(`Running smoke suite: ${shards} shards, scope=${scope}, ports ${BASE_PORT}..${BASE_PORT + shards - 1}`);
    if (passthrough.length) console.log(`Extra Playwright args: ${passthrough.join(' ')}`);

    if (shards > 1) {
        // Measured 2026-07-26 on a 16-core box that was also running FS25,
        // Roblox and Zps: sharding produced dozens of failures that a SEQUENTIAL
        // run of the same specs, under the same load, passed cleanly (root suite
        // 37, state suite 45). Retries did not help — the load lasts the whole
        // run. Sharding is kept because the isolation is sound and a quiet
        // machine or CI box may well cope, but it must not be trusted blindly.
        console.log(
            `\n  ! Parallel shards can fail tests that pass sequentially (UI timing).\n`
            + `    Treat failures as suspect and re-check with: npm run smoke\n`
        );
    }

    const results = await Promise.all(
        Array.from({ length: shards }, (_, i) => runShard(i + 1, shards, scope, passthrough))
    );

    const failed = results.filter(r => r.code !== 0);
    const mins = ((Date.now() - started) / 60000).toFixed(1);

    console.log(`\n════ summary ════`);
    console.log(`${shards} shards in ${mins} min — ${shards - failed.length} ok, ${failed.length} failed`);

    if (failed.length) {
        // Full output only for shards that failed, written to disk so it is
        // greppable rather than buried in scrollback.
        const logDir = path.join(REPO_ROOT, '.tmp');
        fs.mkdirSync(logDir, { recursive: true });
        for (const r of failed) {
            const p = path.join(logDir, `smoke-shard${r.index}-failed.log`);
            fs.writeFileSync(p, r.output);
            console.log(`  shard ${r.index}: full output → ${p}`);
        }
        process.exit(1);
    }
    process.exit(0);
})();
