import { expect, test } from '@playwright/test';

test('renders the desktop control surface and degraded setup state', async ({ page }) => {
  await page.goto('/');

  const initialState = (await (await page.request.get('/api/state')).json()) as {
    assets: Array<{ id: string }>;
  };
  for (const asset of initialState.assets) {
    await page.request.delete(`/api/library/${asset.id}`);
  }
  if (initialState.assets.length > 0) await page.reload();

  await expect(page).toHaveTitle(/Soundkeep/);
  await expect(page.getByRole('heading', { name: 'Soundkeep' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background music' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Soundboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audio library' })).toBeVisible();
  await expect(page.getByText(/Discord token missing/)).toBeVisible();

  const health = await page.request.get('/api/health/live');
  expect(health.ok()).toBe(true);

  await page.locator('#audio-upload').setInputFiles({
    name: 'thunder.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
  });
  await page.locator('#upload-name').fill('Distant thunder');
  await page.locator('#upload-category').fill('Weather');
  await page.getByRole('button', { name: 'Add MP3' }).click();

  await expect(page.getByText('Distant thunder', { exact: true }).first()).toBeVisible();
  const libraryItem = page.getByRole('article').filter({ hasText: 'Distant thunder' });
  await expect(libraryItem).toContainText('Weather');
  await page.getByRole('button', { name: 'Library selection' }).click();
  await expect(page.getByRole('option', { name: /Distant thunder/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await libraryItem.getByRole('button', { name: 'Add button' }).click();
  const soundboard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Soundboard' }) });
  await expect(soundboard.getByRole('button', { name: /Distant thunder/ })).toBeVisible();
  await expect(libraryItem.getByRole('button', { name: 'Remove button' })).toBeVisible();
  await libraryItem.getByRole('button', { name: 'Remove button' }).click();
  await expect(soundboard.getByRole('button', { name: /Distant thunder/ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'YouTube' }).click();
  await expect(page.getByRole('radio', { name: 'Live stream' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Save MP3' })).toBeVisible();
});
