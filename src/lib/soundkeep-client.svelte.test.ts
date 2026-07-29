import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}));

import { SoundkeepClient, STATE_REFRESH_TIMEOUT_MILLISECONDS } from './soundkeep-client.svelte';

describe('SoundkeepClient state refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('leaves the initial skeleton and permits retry after a state request times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      })
    );
    const client = new SoundkeepClient();
    client.showError = vi.fn();

    const refresh = client.refresh(true);
    await vi.advanceTimersByTimeAsync(STATE_REFRESH_TIMEOUT_MILLISECONDS);
    await refresh;

    expect(client.initialLoading).toBe(false);
    expect(client.refreshing).toBe(false);
    expect(client.stateError).toContain('timed out');
    expect(client.showError).toHaveBeenCalledOnce();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return Response.json({
          discord: {},
          guilds: [],
          sources: [],
          assets: [],
          scenes: [],
          activity: [],
          playback: {},
          masterVolume: 0.8,
          pcmCache: {},
          capabilities: {}
        });
      })
    );
    await client.refresh(false);

    expect(client.stateError).toBeNull();
    expect(client.refreshing).toBe(false);
  });

  it('rejects a successful HTML response instead of replacing application state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('<html>Sign in</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      })
    );
    const client = new SoundkeepClient();

    await expect(client.request('/api/state')).rejects.toThrow('unexpected text/html response');
  });
});
