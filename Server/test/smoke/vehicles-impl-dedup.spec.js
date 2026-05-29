// vehicles-impl-dedup.spec.js — an emptied loader bucket reports two fill units
// (a real slot + a phantom EMPTY one); once empty both read 0%. The implement
// must still render only ONCE, not twice at "0%". Driven via the replay path so
// we can feed an exact payload without touching the mock scenarios.

const { test, expect } = require('@playwright/test');

function recordingWithEmptyBucket() {
    return [
        JSON.stringify({ meta: { v: 1, startedAt: new Date().toISOString() } }),
        JSON.stringify({
            t: 0,
            payload: {
                exportedAt: new Date().toISOString(),
                gameDay: 5, gameTime: '10:00', farmBalance: 1000,
                weather: { typeId: 0, title: 'Jasno', temperature: 18, forecast: [] },
                fields: [], animals: [], storage: [], productions: [], prices: [], events: [], availableFruits: [],
                vehicles: [{
                    name: 'Nakladač', typeName: 'Nakladač', isInUse: false,
                    motorHours: 10, fuelPercent: 80, fuelLiters: 80, fuelCapacity: 100,
                    implements: [{
                        name: 'Univerzální lžíce',
                        fillUnits: [
                            { fillType: 'SILAGE', typeTitle: 'Siláž', levelL: 0, capacityL: 4000, percent: 0 },
                            { fillType: 'EMPTY',  typeTitle: '',      levelL: 0, capacityL: 4000, percent: 0 },
                        ],
                    }],
                }],
            },
        }),
    ].join('\n');
}

test('emptied loader bucket renders once, not duplicated at 0%', async ({ page, request }) => {
    await page.goto('/');
    const { name } = await (await request.post('/diag/replay/upload?name=bucket.jsonl', {
        data: recordingWithEmptyBucket(), headers: { 'content-type': 'text/plain' },
    })).json();
    await request.post('/diag/replay/start', { data: { name } });

    // Basic view shows attached implements as .vc-impl-line; the bucket's two
    // empty units must collapse to a single line.
    await expect(page.locator('.vc-impl-line')).toHaveCount(1, { timeout: 8000 });

    await request.post('/diag/replay/stop');
    await request.delete('/diag/recordings/' + name);
});
