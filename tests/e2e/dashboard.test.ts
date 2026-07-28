import { expect, test } from '@playwright/test';

test('supports the desktop dashboard navigation and audio workflow', async ({ page }) => {
  await page.goto('/');
  const consoleNav = page.locator('a[data-sidebar="menu-button"][data-size="default"][href="/"]');
  const libraryNav = page.locator('a[data-sidebar="menu-button"][href="/library"]');
  const settingsNav = page.locator('a[data-sidebar="menu-button"][href="/settings"]');

  const initialState = (await (await page.request.get('/api/state')).json()) as {
    assets: Array<{ id: string }>;
  };
  for (const asset of initialState.assets) {
    await page.request.delete(`/api/library/${asset.id}`);
  }
  if (initialState.assets.length > 0) await page.reload();

  await expect(page).toHaveTitle(/Soundkeep/);
  await expect(page.getByRole('link', { name: /Soundkeep/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Session console' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background music' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Soundboard' })).toBeVisible();
  await expect(page.getByText(/Discord token missing/)).toBeVisible();

  const health = await page.request.get('/api/health/live');
  expect(health.ok()).toBe(true);

  await libraryNav.click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'Audio library' })).toBeVisible();

  await page.locator('#audio-upload').setInputFiles({
    name: 'thunder.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
  });
  await page.locator('#upload-name').fill('Distant thunder');
  await page.locator('#upload-category').fill('Weather');
  await page.getByRole('button', { name: 'Add MP3' }).click();

  await expect(page.getByText('Distant thunder', { exact: true }).first()).toBeVisible();
  const libraryItem = page.getByRole('row').filter({ hasText: 'Distant thunder' });
  await expect(libraryItem).toContainText('Weather');
  await libraryItem.getByRole('button', { name: 'Add Distant thunder to soundboard' }).click();
  await expect(libraryItem).toContainText('Soundboard');

  await consoleNav.click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Library selection' }).click();
  await expect(page.getByRole('option', { name: /Distant thunder/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const soundboard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Soundboard' }) });
  await expect(soundboard.getByRole('button', { name: /Distant thunder/ })).toBeVisible();

  await libraryNav.click();
  await expect(page).toHaveURL(/\/library$/);
  const updatedLibraryItem = page.getByRole('row').filter({ hasText: 'Distant thunder' });
  await updatedLibraryItem
    .getByRole('button', { name: 'Remove Distant thunder from soundboard' })
    .click();

  await consoleNav.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(soundboard.getByRole('button', { name: /Distant thunder/ })).toHaveCount(0);

  await libraryNav.click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator('#audio-upload')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);

  await settingsNav.click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Master output')).toBeVisible();
});
