// i18n.spec.js — language switch (cs default → en). Verifies the dictionary +
// DOM walker translate the navbar/section chrome and that the default Czech
// stays untouched (no-op path).

const { test, expect } = require('@playwright/test');

test.describe('i18n language switch', () => {
    test('default is Czech', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.nav-links a', { hasText: 'Kalendář polí' })).toBeVisible();
        // English string must NOT be present in cs mode.
        await expect(page.locator('.nav-links a', { hasText: 'Field calendar' })).toHaveCount(0);
    });

    test('switching to en translates the chrome', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.lang', 'en'); } catch (_) {}
        });
        await page.goto('/');
        // Navbar link + a section header should be English now.
        await expect(page.locator('.nav-links a', { hasText: 'Field calendar' })).toBeVisible({ timeout: 8000 });
        await expect(page.locator('.nav-links a', { hasText: 'History' })).toBeVisible();
        // <html lang> reflects the choice.
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        // A dynamically-rendered section header gets translated by the observer.
        await expect(page.locator('body')).toContainText('Market prices', { timeout: 8000 });
    });

    test('calendar chrome translates to en', async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.setItem('fs25.dash.v1.lang', 'en'); } catch (_) {}
        });
        await page.goto('/calendar.html');
        await expect(page.locator('.nav-links a', { hasText: 'Field calendar' })).toBeVisible({ timeout: 8000 });
        // "Co potřebuje" column header → "What it needs"
        await expect(page.locator('body')).toContainText('What it needs', { timeout: 10000 });
    });
});
