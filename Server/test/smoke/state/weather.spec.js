// weather.spec.js — FUNCTIONAL assertions for the `weather` povrch (surface).
// Documents weather icon + label + temperature rendering per typeId, forecast
// strip visibility, and boundary cases (out-of-range typeIds, null values).
//
// Weather enums (index.html):
//   WEATHER_ICON = { 0: '☀️', 1: '☀️', 2: '🌤', 3: '☁️', 4: '🌧', 5: '❄️', 6: '⛈', 7: '🌨', 8: '🌫' }
//   WEATHER_CS = { 0: 'Jasno', 1: 'Slunečno', 2: 'Polojasno', 3: 'Oblačno', 4: 'Déšť', 5: 'Sněžení', 6: 'Bouřka', 7: 'Kroupy', 8: 'Mlha' }
//
// Rendering logic (index.html renderData):
//   wLabel = (w.typeId != null && w.typeId >= 0) ? (WEATHER_CS[w.typeId] ?? `typ_${w.typeId}`) : (w.title || '')
//   wEmoji = (w.typeId != null && w.typeId >= 0) ? (WEATHER_ICON[w.typeId] ?? '·') : '·'

const { test, expect } = require('@playwright/test');

// ── helpers ────────────────────────────────────────────────────────────────────

async function setScenario(request, name) {
    const resp = await request.post('/mock/scenario', { data: { scenario: name } });
    if (!resp.ok()) throw new Error(`scenario "${name}": ${resp.status()}`);
    // mock-data.js polls every 1 s; allow for WS broadcast.
    await new Promise(r => setTimeout(r, 3000));
}

async function gotoDashboard(page) {
    await page.goto('/');
    await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 12_000 });
    await page.waitForTimeout(500);
}

test.describe('weather — typeId icon + label rendering', () => {
    test.beforeEach(async ({ page, request }) => {
        // Each weather test uses 'default' scenario but overrides weather data via
        // POST /mock/scenario with a custom scenario name.
        await setScenario(request, 'default');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('typeId 0 (Jasno) displays sun icon ☀️ and label "Jasno"', async ({ page, request }) => {
        // Override scenario with typeId 0
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-sun' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('☀️');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Jasno');
    });

    test('typeId 1 (Slunečno) displays sun icon ☀️ and label "Slunečno"', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-slunecno' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('☀️');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Slunečno');
    });

    test('typeId 2 (Polojasno) displays partly cloudy icon 🌤', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-polojasno' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('🌤');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Polojasno');
    });

    test('typeId 3 (Oblačno) displays cloudy icon ☁️', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-oblacno' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('☁️');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Oblačno');
    });

    test('typeId 4 (Déšť) displays rain icon 🌧', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-dest' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('🌧');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Déšť');
    });

    test('typeId 5 (Sněžení) displays snow icon ❄️', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-snezeni' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('❄️');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Sněžení');
    });

    test('typeId 6 (Bouřka) displays thunderstorm icon ⛈', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-bourka' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('⛈');

        // WEATHER_CS[6] = 'Bouřka' (index.html:378)
        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Bouřka');
    });

    test('typeId 7 (Kroupy) displays hail icon 🌨', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-kroupy' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('🌨');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Kroupy');
    });

    test('typeId 8 (Mlha/fog) displays fog icon 🌫 and label "Mlha"', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-boundary-ok' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('🌫');

        const sub = page.locator('#kpi-weather-sub');
        await expect(sub).toContainText('Mlha');
    });

    test('boundary-low: typeId -1 displays fallback dot · (unknown weather)', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-boundary-low' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('·');
    });

    test('boundary-high: typeId 9 displays fallback dot · and label typ_9', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-boundary-high' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('·');

        const sub = page.locator('#kpi-weather-sub');
        // WEATHER_CS[9] undefined → fallback to `typ_${w.typeId}`
        await expect(sub).toContainText('typ_9');
    });

    test('typeId null displays fallback dot · and uses title fallback', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-typeid-null' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const icon = page.locator('#kpi-weather-icon');
        await expect(icon).toHaveText('·');
    });
});

test.describe('weather — temperature display', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'default');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('temperature != null displays current temp (18 °C)', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-temp-present' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const temp = page.locator('#kpi-weather-temp');
        await expect(temp).toContainText('18 °C');
    });

    test('temperature === null displays fallback "—"', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-temp-missing' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const temp = page.locator('#kpi-weather-temp');
        await expect(temp).toHaveText('—');
    });

    test('temperatureMin + Max present appends range to sub-label (8–26 °C)', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-minmax-present' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const sub = page.locator('#kpi-weather-sub');
        // Sub-label should contain both the weather label and the range
        await expect(sub).toContainText('8–26 °C');
    });

    test('temperatureMin or Max missing shows only label without range', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-minmax-missing' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const sub = page.locator('#kpi-weather-sub');
        // Should NOT contain a range pattern
        const text = await sub.textContent();
        // Look for pattern like "8–26" — if missing temps, shouldn't find it
        expect(text).not.toMatch(/\d+–\d+/);
    });
});

test.describe('weather — forecast strip visibility + rendering', () => {
    test.beforeEach(async ({ page, request }) => {
        await setScenario(request, 'default');
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.syncMode', 'local'); } catch (_) {}
        });
    });

    test('forecast.length > 0 renders strip with 3 day rows', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-visible' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const fcEl = page.locator('#kpi-weather-forecast');
        // Strip is not :empty, so CSS display:flex applies
        const visible = await fcEl.isVisible();
        expect(visible).toBe(true);

        // Should have 3 .forecast-day children
        const days = page.locator('#kpi-weather-forecast .forecast-day');
        await expect(days).toHaveCount(3);

        // Each day should have icon + temp
        for (let i = 0; i < 3; i++) {
            const day = days.nth(i);
            const icon = day.locator('.forecast-icon');
            await expect(icon).not.toHaveText('');
        }
    });

    test('forecast.length === 1 (boundary-ok) renders single day row', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-boundary-one' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const fcEl = page.locator('#kpi-weather-forecast');
        const days = page.locator('#kpi-weather-forecast .forecast-day');
        await expect(days).toHaveCount(1);

        const visible = await fcEl.isVisible();
        expect(visible).toBe(true);
    });

    test('forecast === [] (boundary-low) hides strip (empty pseudo-selector)', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-empty' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const fcEl = page.locator('#kpi-weather-forecast');
        const days = page.locator('#kpi-weather-forecast .forecast-day');
        await expect(days).toHaveCount(0);

        // CSS :empty → display: none
        const visible = await fcEl.isVisible();
        expect(visible).toBe(false);
    });

    test('forecast === null (chybějící pole) renders empty strip', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-null' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const fcEl = page.locator('#kpi-weather-forecast');
        const days = page.locator('#kpi-weather-forecast .forecast-day');
        await expect(days).toHaveCount(0);

        const visible = await fcEl.isVisible();
        expect(visible).toBe(false);
    });

    test('forecast item with typeId 99 (out of range) shows fallback dot ·', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-icon-fallback' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const day = page.locator('#kpi-weather-forecast .forecast-day').first();
        const icon = day.locator('.forecast-icon');
        await expect(icon).toHaveText('·');
    });

    test('forecast item with null temperatureMin/Max omits temp span', async ({ page, request }) => {
        await request.post('/mock/scenario', { data: { scenario: 'st-weather-forecast-temp-missing' } });
        await new Promise(r => setTimeout(r, 3000));
        await gotoDashboard(page);

        const day = page.locator('#kpi-weather-forecast .forecast-day').first();
        const tempSpan = day.locator('.forecast-temp');
        await expect(tempSpan).toHaveCount(0);
    });
});
