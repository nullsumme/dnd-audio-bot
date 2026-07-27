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
  await expect(page.getByRole('heading', { name: 'Ambience mixer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Soundboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audio library' })).toBeVisible();
  await expect(page.getByText('Discord token missing.')).toBeVisible();

  const health = await page.request.get('/api/health/live');
  expect(health.ok()).toBe(true);

  await page.locator('#audio-upload').setInputFiles({
    name: 'thunder.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
  });
  await page.getByLabel('Display name').fill('Distant thunder');
  await page.getByLabel('Category').fill('Weather');
  await page.getByRole('button', { name: 'Upload' }).click();

  await expect(page.getByText('Distant thunder', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Weather', { exact: true }).first()).toBeVisible();
});
