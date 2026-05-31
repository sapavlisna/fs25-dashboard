// diag.spec.js — diagnostic capture (phase 3): a real browser triggers JS
// errors, diag.js forwards them to the server, and they fold into an active
// recording together with a settings/env snapshot. Replay is covered by the
// dependency-free node test (test/diag.test.js); this verifies the client wiring.

const { test, expect } = require('@playwright/test');

test.describe('diagnostic capture', () => {
    test('client errors + settings fold into an active recording', async ({ page, request }) => {
        const start = await request.post('/diag/record/start', { data: { note: 'smoke', lang: 'en' } });
        expect(start.ok()).toBeTruthy();
        const { recording } = await start.json();

        // Load a page — diag.js posts a settings snapshot ~400 ms after load.
        await page.goto('/');
        await page.waitForTimeout(800);

        // Wrapped console.error → POST /diag/client-log.
        await page.evaluate(() => console.error('diag-smoke-boom'));
        // Uncaught error event → window 'error' listener → POST.
        await page.evaluate(() =>
            window.dispatchEvent(new ErrorEvent('error', {
                message: 'diag-smoke-uncaught',
                error: new Error('diag-smoke-uncaught'),
            })),
        );
        await page.waitForTimeout(500);

        const status = await (await request.get('/diag/record/status')).json();
        expect(status.active).toBeTruthy();
        expect(status.clientErrors).toBeGreaterThanOrEqual(1);

        const stop = await (await request.post('/diag/record/stop')).json();
        expect(stop.name).toBe(recording);

        const dl = await request.get('/diag/recordings/' + recording);
        expect(dl.ok()).toBeTruthy();
        const lines = (await dl.text()).split('\n').filter(Boolean).map(l => JSON.parse(l));
        const meta = lines[0].meta;
        const clientLines = lines.filter(l => l.client);

        expect(clientLines.some(l => /diag-smoke/.test(l.client.message))).toBeTruthy();
        expect(meta.clientSettings).toBeTruthy();
        expect(meta.clientSettings.values).toBeTruthy();

        // Tidy up the recording this test created.
        await request.delete('/diag/recordings/' + recording);
    });

    test('retroactive save-buffer writes a recording from the rolling buffer', async ({ request }) => {
        // The server buffers frames continuously; wait until at least one is in.
        await expect.poll(async () => {
            const st = await (await request.get('/diag/record/status')).json();
            return st.buffered || 0;
        }, { timeout: 8000 }).toBeGreaterThan(0);

        const r = await (await request.post('/diag/record/save-buffer', { data: { note: 'retro' } })).json();
        expect(r.name).toMatch(/^rec-buffer-.*\.jsonl$/);
        expect(r.frames).toBeGreaterThan(0);

        // It shows up in the list and its meta marks it retroactive.
        const recs = await (await request.get('/diag/recordings')).json();
        expect(recs.some(x => x.name === r.name)).toBeTruthy();

        const dl = await request.get('/diag/recordings/' + r.name);
        const meta = JSON.parse((await dl.text()).split('\n')[0]).meta;
        expect(meta.retroactive).toBeTruthy();
        expect(meta.note).toBe('retro');

        await request.delete('/diag/recordings/' + r.name);
    });

    test('settings panel can start, stop and list a recording', async ({ page, request }) => {
        await page.goto('/');
        await page.locator('#notif-toggle').click();
        await page.locator('#notif-modal-overlay.open').waitFor();
        // The Diagnostics tab is hidden by default — unlock it by clicking the
        // ⚙ icon in the modal header 4× (the counter resets when the modal closes).
        const gear = page.locator('#settings-gear-icon');
        for (let i = 0; i < 4; i++) await gear.click();
        await page.locator('[data-tab="diag"]').click();

        await page.locator('#diag-note').fill('ui-test');
        const btn = page.locator('#diag-record-btn');
        await btn.click();
        // Button flips to the "stop" state (danger class).
        await expect(btn).toHaveClass(/danger/);

        const active = await (await request.get('/diag/record/status')).json();
        expect(active.active).toBeTruthy();

        await btn.click();                       // stop
        await expect(btn).toHaveClass(/primary/);

        // The just-finished recording shows up in the list with its note.
        const row = page.locator('#diag-list .diag-row').first();
        await expect(row).toBeVisible();
        await expect(page.locator('#diag-list')).toContainText('ui-test');
        await expect(row.locator('.diag-dl')).toHaveAttribute('href', /\/diag\/recordings\/rec-/);

        // Clean up via API using the row's name.
        const name = await row.getAttribute('data-name');
        if (name) await request.delete('/diag/recordings/' + name);
    });
});
