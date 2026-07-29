<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Spinner } from '$lib/components/ui/spinner';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AudioAsset } from '$lib/types';

  let { asset, onclose }: { asset: AudioAsset | null; onclose: () => void } = $props();

  const soundkeep = useSoundkeep();

  async function confirm() {
    if (!asset) return;
    if (await soundkeep.deleteAsset(asset)) onclose();
  }
</script>

<AlertDialog.Root open={asset !== null} onOpenChange={(open) => !open && onclose()}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{asset?.name}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the library entry, saved MP3, artwork, and scene references. This cannot be
        undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant="destructive"
        disabled={!asset || soundkeep.busy !== null}
        onclick={confirm}
      >
        {#if soundkeep.busy?.startsWith('delete-')}<Spinner data-icon="inline-start" />{/if}
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
