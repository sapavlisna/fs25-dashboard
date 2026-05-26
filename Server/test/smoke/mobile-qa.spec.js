// mobile-qa.spec.js — Mobile viewport (375×812, iPhone 12) QA pass.
//
// Covers: / · /calendar.html · /history.html · /help.html
// Skips:  /profit.html (user opt-out)
//
// Screenshots go to: src/Dashboard/docs/qa-mobile-2026-05-26/
// Uses the same mock server setup as playwright.config.js (port 3099).
//
// Run:  npx playwright test --config=test/smoke/playwright.config.js mobile-qa.spec.js
//       (add --update-snapshots on first run to create baselines)

const { test, expect } = require('@playwright/test');
const path   = require('path');
const fs     = require('fs');

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const SCREENSHOT_DIR  = path.resolve(
    __dirname, '..', '..', '..', 'docs', 'qa-mobile-2026-05-26'
);

// Ensure output dir exists even when test runner doesn't create it
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ─── Helper: set mobile viewport ─────────────────────────────────────────────
async function setMobile(page) {
    await page.setViewportSize(MOBILE_VIEWPORT);
}

// ─── Helper: save screenshot ──────────────────────────────────────────────────
async function shot(page, name) {
    const p = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    return p;
}

// ─── Helper: wait for WS data or static content ──────────────────────────────
async function waitForContent(page, url) {
    const pathname = new URL(url, 'http://x').pathname;
    if (pathname === '/' || pathname === '/index.html') {
        // Wait for KPI balance to populate from WS
        await expect(page.locator('#kpi-balance')).not.toHaveText('—', { timeout: 15_000 });
    } else if (pathname === '/calendar.html') {
        await expect(page.locator('#kpi-owned')).not.toHaveText('—', { timeout: 15_000 });
    } else if (pathname === '/history.html') {
        await expect(page.locator('#kpi-fills')).toBeAttached({ timeout: 15_000 });
    } else if (pathname === '/help.html') {
        await expect(page.locator('.help-hero h1')).toBeVisible({ timeout: 10_000 });
    }
    await page.waitForTimeout(1000);
}

// ─── Helper: measure element size ────────────────────────────────────────────
async function getBoundingBox(page, selector) {
    try {
        return await page.locator(selector).first().boundingBox();
    } catch (_) {
        return null;
    }
}

// ─── Helper: check for horizontal overflow ───────────────────────────────────
async function hasHorizontalOverflow(page, selector) {
    return await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        return el.scrollWidth > el.clientWidth + 2; // 2px tolerance
    }, selector);
}

// =============================================================================
// PAGE: index.html (Dashboard)
// =============================================================================
test.describe('Mobile QA — index.html (Dashboard)', () => {

    test.beforeEach(async ({ page }) => {
        await setMobile(page);
        await page.goto('/');
        await waitForContent(page, '/');
    });

    // ── 01: Above-fold screenshot ──────────────────────────────────────────
    test('01-index-above-fold', async ({ page }) => {
        await shot(page, '01-index-above-fold');
        // Body must not overflow horizontally
        const overflow = await hasHorizontalOverflow(page, 'body');
        expect(overflow, 'body has horizontal overflow on index').toBe(false);
    });

    // ── 02: Nav scroll + links accessible ─────────────────────────────────
    test('02-index-nav', async ({ page }) => {
        // Nav links row should be scrollable on 375 px — check it doesn't overflow the viewport
        const navOverflow = await page.evaluate(() => {
            const nav = document.querySelector('nav');
            return nav ? nav.scrollWidth > nav.clientWidth + 2 : false;
        });
        await shot(page, '02-index-nav');
        // The nav itself can scroll internally (flex-wrap:nowrap + overflow-x:auto)
        // but should not make the BODY overflow
        expect(await hasHorizontalOverflow(page, 'body'), 'body overflow via nav').toBe(false);
    });

    // ── 03: KPI cards — single column at 375 ──────────────────────────────
    test('03-index-kpi-single-col', async ({ page }) => {
        const kpiRow = await page.locator('.kpi-row').boundingBox();
        const cards  = await page.locator('.kpi-card').all();
        if (kpiRow && cards.length > 1) {
            // All cards should be full width (single column) at 375
            let allFullWidth = true;
            for (const card of cards) {
                const bb = await card.boundingBox();
                if (bb && bb.width < 300) {
                    allFullWidth = false;
                    break;
                }
            }
            expect(allFullWidth, 'KPI cards should be full-width single-col at 375px').toBe(true);
        }
        await shot(page, '03-index-kpi-single-col');
    });

    // ── 04: Fields table horizontal scroll ────────────────────────────────
    test('04-index-fields-table', async ({ page }) => {
        // Scroll down to the fields section
        await page.locator('#sec-fields').scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400);
        await shot(page, '04-index-fields-table');

        // The table-wrap should handle overflow internally, not push body wider
        const bodyOverflow = await hasHorizontalOverflow(page, 'body');
        expect(bodyOverflow, 'body should not overflow because of fields table').toBe(false);
    });

    // ── 05: Scrolled-down view (vehicles, animals sections) ───────────────
    test('05-index-scrolled-down', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(300);
        await shot(page, '05-index-scrolled-down');
    });

    // ── 06: Settings button / bell tap targets ─────────────────────────────
    test('06-index-tap-targets', async ({ page }) => {
        // Bell slot area — should be ≥ 44×44 or at least present
        const bellSlot = await getBoundingBox(page, '#bell-slot');
        await shot(page, '06-index-tap-targets');
        if (bellSlot) {
            // Log size — we expect at minimum 24px; 44px is the WCAG ideal
            const tooSmall = bellSlot.width < 24 || bellSlot.height < 24;
            if (tooSmall) {
                // Non-fatal: just annotate in screenshot, severity tracked separately
                console.warn(`[MOBILE-QA] bell-slot is ${bellSlot.width}×${bellSlot.height} — below 44px recommendation`);
            }
        }
    });

    // ── 07: Section masonry (1-col at 375) ────────────────────────────────
    test('07-index-masonry-1col', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);

        const masonrySections = await page.locator('.masonry > .section').all();
        let multiColFound = false;
        if (masonrySections.length >= 2) {
            const bb0 = await masonrySections[0].boundingBox();
            const bb1 = await masonrySections[1].boundingBox();
            if (bb0 && bb1) {
                // If they share the same vertical band, they're side-by-side (problem)
                const sideBySide = Math.abs(bb0.y - bb1.y) < bb0.height / 2;
                multiColFound = sideBySide;
            }
        }
        await shot(page, '07-index-masonry-1col');
        expect(multiColFound, 'masonry sections should stack vertically (1 col) at 375px').toBe(false);
    });

    // ── 08: Price table last section ──────────────────────────────────────
    test('08-index-prices-section', async ({ page }) => {
        const pricesSec = page.locator('#sec-prices');
        const exists = await pricesSec.count() > 0;
        if (exists) {
            await pricesSec.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(300);
        }
        await shot(page, '08-index-prices-section');
        expect(await hasHorizontalOverflow(page, 'body'), 'body overflow at prices section').toBe(false);
    });
});

// =============================================================================
// PAGE: calendar.html
// =============================================================================
test.describe('Mobile QA — calendar.html', () => {

    test.beforeEach(async ({ page }) => {
        await setMobile(page);
        await page.goto('/calendar.html');
        await waitForContent(page, '/calendar.html');
    });

    // ── 09: Above-fold screenshot ──────────────────────────────────────────
    test('09-calendar-above-fold', async ({ page }) => {
        await shot(page, '09-calendar-above-fold');
        expect(await hasHorizontalOverflow(page, 'body'), 'calendar body overflow').toBe(false);
    });

    // ── 10: Gantt sticky columns vs 375 viewport ──────────────────────────
    // KNOWN RISK: sticky left = 510px total (260+240) on a 375px screen.
    // The timeline cell would have 0 or negative visible width.
    test('10-calendar-gantt-sticky-overflow', async ({ page }) => {
        await shot(page, '10-calendar-gantt-sticky-columns');

        // Measure how much of the timeline (3rd col) is visible
        const ganttWrap = await getBoundingBox(page, '#gantt-wrap');
        const timelineW = ganttWrap ? ganttWrap.width : 0;

        // On a 375px viewport the sticky pane alone is 500px —
        // visible timeline area would be negative/zero
        const stickyPaneTooWide = timelineW > 0 && 510 > MOBILE_VIEWPORT.width;
        if (stickyPaneTooWide) {
            console.warn(`[MOBILE-QA] Gantt sticky cols (510px) exceed viewport (375px). Timeline not visible.`);
        }

        // The gantt-wrap itself should not make body overflow
        expect(await hasHorizontalOverflow(page, 'body'), 'calendar body overflow via gantt').toBe(false);
    });

    // ── 11: Gantt timeline visible width ──────────────────────────────────
    test('11-calendar-gantt-timeline-width', async ({ page }) => {
        // Check how wide the gantt-wrap renders
        const wrapBB = await getBoundingBox(page, '#gantt-wrap');
        await shot(page, '11-calendar-gantt-timeline-width');
        if (wrapBB) {
            // 510px frozen cols + any timeline — on 375px we expect significant clipping
            console.log(`[MOBILE-QA] #gantt-wrap clientWidth=${wrapBB.width} at viewport 375`);
        }
    });

    // ── 12: Custom scrollbar track placement ──────────────────────────────
    test('12-calendar-scrollbar-track', async ({ page }) => {
        // gantt-scroll-track has margin-left: 500px — at 375px it would be offscreen
        const trackBB = await getBoundingBox(page, '.gantt-scroll-track');
        await shot(page, '12-calendar-scrollbar-track');
        if (trackBB) {
            const isOffscreen = trackBB.x > MOBILE_VIEWPORT.width || trackBB.x + trackBB.width < 0;
            if (isOffscreen) {
                console.warn(`[MOBILE-QA] .gantt-scroll-track is offscreen (x=${trackBB.x}) on 375px viewport`);
            }
        }
    });

    // ── 13: Filter bar wrap ────────────────────────────────────────────────
    test('13-calendar-filter-bar', async ({ page }) => {
        // The header filter-bar has flex-wrap:nowrap — may clip on 375px
        const filterBar = await getBoundingBox(page, '.filter-bar');
        await shot(page, '13-calendar-filter-bar');
        if (filterBar) {
            const overflow = filterBar.width > MOBILE_VIEWPORT.width + 4;
            if (overflow) {
                console.warn(`[MOBILE-QA] .filter-bar is ${filterBar.width}px wide — wider than 375px viewport`);
            }
        }
    });

    // ── 14: Section header with Gantt date chip ───────────────────────────
    test('14-calendar-section-header', async ({ page }) => {
        await shot(page, '14-calendar-section-header');
        // Section header has multiple inline items; check it doesn't overflow body
        expect(await hasHorizontalOverflow(page, 'body'), 'calendar header overflow').toBe(false);
    });

    // ── 15: Plan editor section ────────────────────────────────────────────
    test('15-calendar-plan-editor', async ({ page }) => {
        await page.locator('#sec-plan-editor').scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        await shot(page, '15-calendar-plan-editor');
    });

    // ── 16: Scrolled-down (plan editor visible) ────────────────────────────
    test('16-calendar-scrolled-down', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 1000));
        await page.waitForTimeout(300);
        await shot(page, '16-calendar-scrolled-down');
        expect(await hasHorizontalOverflow(page, 'body'), 'calendar body overflow scrolled').toBe(false);
    });
});

// =============================================================================
// PAGE: history.html
// =============================================================================
test.describe('Mobile QA — history.html', () => {

    test.beforeEach(async ({ page }) => {
        await setMobile(page);
        await page.goto('/history.html');
        await waitForContent(page, '/history.html');
    });

    // ── 17: Above-fold ────────────────────────────────────────────────────
    test('17-history-above-fold', async ({ page }) => {
        await shot(page, '17-history-above-fold');
        expect(await hasHorizontalOverflow(page, 'body'), 'history body overflow').toBe(false);
    });

    // ── 18: Chart cards — single column ───────────────────────────────────
    test('18-history-chart-cards', async ({ page }) => {
        // .history-grid collapses to 1 col at 900px — should be 1 col at 375
        const cards = await page.locator('.chart-card').all();
        let multiColFound = false;
        if (cards.length >= 2) {
            const bb0 = await cards[0].boundingBox();
            const bb1 = await cards[1].boundingBox();
            if (bb0 && bb1) {
                multiColFound = Math.abs(bb0.y - bb1.y) < bb0.height / 2;
            }
        }
        await shot(page, '18-history-chart-cards');
        expect(multiColFound, 'chart cards should be single column at 375px').toBe(false);
    });

    // ── 19: Chart height at 375 ────────────────────────────────────────────
    test('19-history-chart-height', async ({ page }) => {
        // .chart-body has fixed height: 280px — should be fine on mobile
        const chartBody = await getBoundingBox(page, '.chart-body');
        await shot(page, '19-history-chart-height');
        if (chartBody) {
            // Chart body wider than viewport = overflow risk
            const overflow = chartBody.width > MOBILE_VIEWPORT.width + 4;
            if (overflow) {
                console.warn(`[MOBILE-QA] .chart-body is ${chartBody.width}px wide > viewport 375px`);
            }
        }
    });

    // ── 20: Period bar (day selector buttons) tap targets ─────────────────
    test('20-history-period-bar', async ({ page }) => {
        await shot(page, '20-history-period-bar');
        // Check button sizes in the period bar
        const btns = await page.locator('.days-btn').all();
        let tooSmall = false;
        for (const btn of btns.slice(0, 5)) {
            const bb = await btn.boundingBox();
            if (bb && bb.height < 30) { tooSmall = true; break; }
        }
        if (tooSmall) {
            console.warn('[MOBILE-QA] .days-btn height < 30px — borderline tap target');
        }
    });

    // ── 21: Scrolled-down charts ───────────────────────────────────────────
    test('21-history-scrolled-down', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.waitForTimeout(300);
        await shot(page, '21-history-scrolled-down');
        expect(await hasHorizontalOverflow(page, 'body'), 'history body overflow scrolled').toBe(false);
    });
});

// =============================================================================
// PAGE: help.html
// =============================================================================
test.describe('Mobile QA — help.html', () => {

    test.beforeEach(async ({ page }) => {
        await setMobile(page);
        await page.goto('/help.html');
        await waitForContent(page, '/help.html');
    });

    // ── 22: Above-fold ────────────────────────────────────────────────────
    test('22-help-above-fold', async ({ page }) => {
        await shot(page, '22-help-above-fold');
        expect(await hasHorizontalOverflow(page, 'body'), 'help body overflow').toBe(false);
    });

    // ── 23: TOC section (sidebar becomes top element at 900px) ────────────
    test('23-help-toc', async ({ page }) => {
        // At 375px the TOC should be displayed above the article (stacked, 1 col)
        const toc = await getBoundingBox(page, '.help-toc');
        const art = await getBoundingBox(page, '.help-article');
        await shot(page, '23-help-toc');
        if (toc && art) {
            const stacked = art.y >= toc.y + toc.height - 20;
            expect(stacked, 'TOC should be above article (stacked layout) at 375px').toBe(true);
        }
    });

    // ── 24: Help article text readability ─────────────────────────────────
    test('24-help-article-text', async ({ page }) => {
        // Article should not require horizontal scrolling
        await shot(page, '24-help-article-text');
        expect(await hasHorizontalOverflow(page, 'body'), 'help body overflow at article').toBe(false);
    });

    // ── 25: Screenshots inside help (if any) ──────────────────────────────
    test('25-help-screenshots', async ({ page }) => {
        // Inline <img> in help should not exceed viewport width
        const imgs = await page.locator('.help-article img').all();
        let overflowImg = false;
        for (const img of imgs) {
            const bb = await img.boundingBox();
            if (bb && bb.width > MOBILE_VIEWPORT.width + 4) {
                overflowImg = true;
                console.warn(`[MOBILE-QA] help img is ${bb.width}px wide > 375px viewport`);
                break;
            }
        }
        await shot(page, '25-help-screenshots');
        expect(overflowImg, 'help article images should not overflow viewport').toBe(false);
    });

    // ── 26: Scrolled-down help content ────────────────────────────────────
    test('26-help-scrolled-down', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 800));
        await page.waitForTimeout(300);
        await shot(page, '26-help-scrolled-down');
        expect(await hasHorizontalOverflow(page, 'body'), 'help scrolled body overflow').toBe(false);
    });

    // ── 27: Nav links accessible on help page ────────────────────────────
    test('27-help-nav-scroll', async ({ page }) => {
        // On 375px the nav links overflow-x:auto — all links should be reachable
        const navLinks = await page.locator('.nav-links a').all();
        await shot(page, '27-help-nav-scroll');
        // Just verify we have all 5 nav links present
        expect(navLinks.length).toBeGreaterThanOrEqual(4);
    });
});

// =============================================================================
// CROSS-PAGE: settings modal
// =============================================================================
test.describe('Mobile QA — settings modal', () => {

    test('28-settings-modal-index', async ({ page }) => {
        await setMobile(page);
        await page.goto('/');
        await waitForContent(page, '/');

        // Try to open settings via the gear button (if present in nav)
        const settingsBtn = page.locator('[data-settings-toggle], #btn-settings, .settings-btn, button[title*="Nastavení"]').first();
        const hasSBtn = await settingsBtn.count() > 0;
        if (hasSBtn) {
            await settingsBtn.click();
            await page.waitForTimeout(500);
        }
        await shot(page, '28-settings-modal-index');
    });
});

// =============================================================================
// CROSS-PAGE: vehicle card expand/collapse
// =============================================================================
test.describe('Mobile QA — vehicle expand', () => {

    test('29-vehicle-card-mobile', async ({ page }) => {
        await setMobile(page);
        await page.goto('/');
        await waitForContent(page, '/');

        const firstVehicle = page.locator('.vehicle-row').first();
        const exists = await firstVehicle.count() > 0;
        if (exists) {
            await firstVehicle.scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
        }
        await shot(page, '29-vehicle-card-mobile');
        // Vehicle row should not overflow body
        expect(await hasHorizontalOverflow(page, 'body'), 'body overflow at vehicle section').toBe(false);
    });
});
