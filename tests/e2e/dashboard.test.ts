import { expect, test } from '@playwright/test';
import { validTestMp3 } from '../fixtures/audio';

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
    buffer: Buffer.from(validTestMp3())
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

  const settingsState = (await (await page.request.get('/api/state')).json()) as {
    discord: {
      audioDiagnostics: {
        bitrateMode: 'auto' | '64000' | '96000' | '128000' | '384000';
      };
    };
  };
  const originalBitrateMode = settingsState.discord.audioDiagnostics.bitrateMode;
  const targetBitrateMode = originalBitrateMode === '384000' ? '96000' : '384000';
  const targetLabel = `${Math.round(Number(targetBitrateMode) / 1_000)} kbps`;
  const qualityCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('heading', { name: 'Discord audio quality' }) });
  const originalLabel =
    originalBitrateMode === 'auto'
      ? 'Auto'
      : `${Math.round(Number(originalBitrateMode) / 1_000)} kbps`;
  let bitrateChanged = false;
  try {
    await expect(qualityCard.getByRole('radio', { name: '384 kbps', exact: true })).toBeVisible();
    const targetRadio = qualityCard.getByRole('radio', { name: targetLabel, exact: true });
    await targetRadio.click();
    await expect(targetRadio).toBeChecked();
    const applyResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/discord/bitrate') && response.request().method() === 'PATCH'
    );
    await qualityCard.getByRole('button', { name: 'Apply bitrate' }).click();
    expect((await applyResponse).ok()).toBe(true);
    bitrateChanged = true;
    await expect(qualityCard).toContainText('Configured');
    await expect(qualityCard).toContainText('Current output');
    await expect(qualityCard).toContainText('Inactive');

    const updatedState = (await (await page.request.get('/api/state')).json()) as {
      discord: {
        audioDiagnostics: {
          bitrateMode: string;
          bitrate: number | null;
          channelBitrate: number | null;
        };
      };
    };
    expect(updatedState.discord.audioDiagnostics).toMatchObject({
      bitrateMode: targetBitrateMode,
      bitrate: null,
      channelBitrate: null
    });
  } finally {
    if (bitrateChanged) {
      const originalRadio = qualityCard.getByRole('radio', {
        name: originalLabel,
        exact: true
      });
      await originalRadio.click();
      await expect(originalRadio).toBeChecked();
      const restoreResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/discord/bitrate') && response.request().method() === 'PATCH'
      );
      await qualityCard.getByRole('button', { name: 'Apply bitrate' }).click();
      expect((await restoreResponse).ok()).toBe(true);
    }
  }
});
