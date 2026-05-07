import { test, expect } from './fixtures.js';

test('theme selector is present with correct options', async ({ page }) => {
    await page.goto('/');

    const select = page.locator('#theme-selector');
    await expect(select).toBeAttached();

    const options = select.locator('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toHaveAttribute('value', 'default');
    await expect(options.nth(1)).toHaveAttribute('value', 'win98');
});

test('selecting a theme updates the stylesheet', async ({ page }) => {
    await page.goto('/');

    const link = page.locator('#theme-stylesheet');
    await expect(link).toHaveAttribute('href', /themes\/default\.css/);

    await page.locator('#theme-selector').selectOption('win98');
    await expect(link).toHaveAttribute('href', /themes\/win98\.css/);

    await page.locator('#theme-selector').selectOption('default');
    await expect(link).toHaveAttribute('href', /themes\/default\.css/);
});

test('theme persists across page reload', async ({ page }) => {
    await page.goto('/');
    await page.locator('#theme-selector').selectOption('win98');

    await page.reload();
    await expect(page.locator('#theme-stylesheet')).toHaveAttribute('href', /themes\/win98\.css/);
    await expect(page.locator('#theme-selector')).toHaveValue('win98');
});

test('invalid saved theme falls back to default', async ({ page }) => {
    await page.context().addInitScript(() => {
        localStorage.setItem('theme', 'nonexistent');
    });

    await page.goto('/');
    await expect(page.locator('#theme-stylesheet')).toHaveAttribute('href', /themes\/default\.css/);
    await expect(page.locator('#theme-selector')).toHaveValue('default');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('default');
});
