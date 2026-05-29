// mockup.spec.js — hidden "mockup mode": replay an uploaded recording AS live
// data through the server. Covers the protocol (server broadcasts the recorded
// frames + a __replayStatus envelope) and the UI (brand gesture reveals the
// controls, ▶ plays, banner shows, stop returns to live).

const { test, expect } = require('@playwright/test');
const WebSocket = require('ws');

const PORT = 3099;

function frame(t, gameDay, balance) {
    return JSON.stringify({
        t,
        payload: {
            exportedAt: new Date().toISOString(),
            gameDay, gameTime: '12:00', farmBalance: balance,
            weather: { typeId: 0, title: 'Jasno', temperature: 18, forecast: [] },
            fields: [], vehicles: [], animals: [], storage: [],
            productions: [], prices: [], events: [], availableFruits: [],
        },
    });
}
function recording(note) {
    return [
        JSON.stringify({ meta: { v: 1, startedAt: new Date().toISOString(), note, frames: 2 } }),
        frame(0, 777, 4242),
        frame(400, 778, 4243),
    ].join('\n');
}

test.describe('mockup mode (replay as live)', () => {
    test('server broadcasts uploaded recording frames + replay status', async ({ request }) => {
        const up = await request.post('/diag/replay/upload?name=proto.jsonl', {
            data: recording('proto'), headers: { 'content-type': 'text/plain' },
        });
        expect(up.ok()).toBeTruthy();
        const { name } = await up.json();

        // Raw WS client to observe what the server pushes.
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        const got = [];
        ws.on('message', d => { try { got.push(JSON.parse(d.toString())); } catch (_) {} });
        await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

        await request.post('/diag/replay/start', { data: { name } });

        await expect.poll(() => got.some(m => m.gameDay === 777 || m.gameDay === 778), { timeout: 6000 }).toBeTruthy();
        expect(got.some(m => m.__replayStatus && m.__replayStatus.active && m.__replayStatus.name === name)).toBeTruthy();

        const status = await (await request.get('/diag/replay/status')).json();
        expect(status.active).toBeTruthy();
        expect(status.total).toBe(2);

        await request.post('/diag/replay/stop');
        const after = await (await request.get('/diag/replay/status')).json();
        expect(after.active).toBeFalsy();

        ws.close();
        await request.delete('/diag/recordings/' + name);
    });

    test('loop flag is honoured by replay status', async ({ request }) => {
        const { name } = await (await request.post('/diag/replay/upload?name=loop.jsonl', {
            data: recording('loop'), headers: { 'content-type': 'text/plain' },
        })).json();

        // Default (once): not looping.
        await request.post('/diag/replay/start', { data: { name } });
        expect((await (await request.get('/diag/replay/status')).json()).loop).toBeFalsy();

        // Explicit loop: status reports looping (and never reaches done).
        await request.post('/diag/replay/start', { data: { name, loop: true } });
        const st = await (await request.get('/diag/replay/status')).json();
        expect(st.loop).toBeTruthy();

        await request.post('/diag/replay/stop');
        await request.delete('/diag/recordings/' + name);
    });

    test('markers parse into replay status; marker endpoint works', async ({ request }) => {
        const withMarker = [
            JSON.stringify({ meta: { v: 1, startedAt: new Date().toISOString() } }),
            frame(0, 100, 1),
            JSON.stringify({ t: 250, marker: { label: 'boom' } }),
            frame(400, 101, 2),
            frame(800, 102, 3),
        ].join('\n');
        const { name } = await (await request.post('/diag/replay/upload?name=mk.jsonl', {
            data: withMarker, headers: { 'content-type': 'text/plain' },
        })).json();

        await request.post('/diag/replay/start', { data: { name } });
        const st = await (await request.get('/diag/replay/status')).json();
        expect(st.markers.length).toBe(1);
        expect(st.markers[0].label).toBe('boom');
        expect(st.markers[0].idx).toBe(1);     // marker at t=250 → first frame with t>=250 (idx 1)

        await request.post('/diag/replay/stop');
        await request.delete('/diag/recordings/' + name);

        // Marker endpoint works even when not recording (buffers a rolling marker).
        const m = await (await request.post('/diag/record/marker', { data: { label: 'x' } })).json();
        expect(m.ok).toBeTruthy();
    });

    test('transport controls (pause/seek/step) update replay status', async ({ request }) => {
        const { name } = await (await request.post('/diag/replay/upload?name=ctl.jsonl', {
            data: recording('ctl'), headers: { 'content-type': 'text/plain' },
        })).json();
        await request.post('/diag/replay/start', { data: { name } });

        let st = await (await request.post('/diag/replay/pause')).json();
        expect(st.paused).toBeTruthy();

        st = await (await request.post('/diag/replay/seek', { data: { idx: 1 } })).json();
        expect(st.idx).toBe(1);

        st = await (await request.post('/diag/replay/step', { data: { delta: -1 } })).json();
        expect(st.idx).toBe(0);
        expect(st.paused).toBeTruthy();

        st = await (await request.post('/diag/replay/resume')).json();
        expect(st.paused).toBeFalsy();

        await request.post('/diag/replay/stop');
        await request.delete('/diag/recordings/' + name);
    });

    test('mockup toggle hides the controls again; record button stays visible', async ({ page }) => {
        page.on('dialog', d => d.accept());
        await page.goto('/');
        for (let i = 0; i < 10; i++) await page.locator('.nav-brand').click();  // gesture → settings/diag

        await expect(page.locator('#diag-mockup-tools')).toBeVisible();
        const toggle = page.locator('#diag-mockup-toggle');
        await expect(toggle).toBeChecked();
        await expect(page.locator('#diag-record-btn')).toBeVisible();

        // Switch mockup mode off → its controls hide, but recording stays available.
        await toggle.evaluate(el => { el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); });
        await expect(page.locator('#diag-mockup-tools')).toBeHidden();
        await expect(page.locator('body')).not.toHaveClass(/mockup-mode/);
        await expect(page.locator('#diag-record-btn')).toBeVisible();
    });

    test('brand gesture reveals controls; ▶ plays, banner shows, stop returns to live', async ({ page, request }) => {
        page.on('dialog', d => d.accept());

        const up = await request.post('/diag/replay/upload?name=ui.jsonl', {
            data: recording('ui'), headers: { 'content-type': 'text/plain' },
        });
        const { name } = await up.json();

        await page.goto('/');
        const brand = page.locator('.nav-brand');
        for (let i = 0; i < 10; i++) await brand.click();

        await expect(page.locator('body')).toHaveClass(/mockup-mode/);
        await expect(page.locator('#diag-mockup-tools')).toBeVisible();

        // Re-enter the tab so the list refreshes and shows the uploaded recording.
        await page.locator('[data-tab="notif"]').click();
        await page.locator('[data-tab="diag"]').click();

        const row = page.locator(`.diag-row[data-name="${name}"]`);
        await expect(row).toBeVisible();
        const play = row.locator('.diag-play');
        await expect(play).toBeVisible();          // play button only shows in mockup mode
        await play.click();

        await expect(page.locator('#replay-banner')).toBeVisible();
        await expect(page.locator('#replay-banner')).toContainText('MOCKUP');
        await expect(page.locator('body')).toHaveClass(/replaying/);
        await expect(page.locator('#rp-seek')).toBeVisible();

        // Frame inspector toggles open and shows JSON of the current payload.
        await page.locator('#rp-inspect').click();
        await expect(page.locator('#replay-inspector')).toBeVisible();
        await expect(page.locator('#ri-body')).toContainText('gameDay');
        await page.locator('#ri-close').click();
        await expect(page.locator('#replay-inspector')).toBeHidden();

        await page.locator('#replay-banner-stop').click();
        await expect(page.locator('#replay-banner')).toBeHidden();

        await request.delete('/diag/recordings/' + name);
    });
});
