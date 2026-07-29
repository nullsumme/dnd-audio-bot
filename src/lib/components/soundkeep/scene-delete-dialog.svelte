<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';

  let { scene, onclose }: { scene: SceneCollection | null; onclose: () => void } = $props();

  const soundkeep = useSoundkeep();

  async function confirm() {
    if (!scene) return;
    const deleted = await soundkeep.deleteScene(scene);
    if (deleted) onclose();
  }
</script>

<AlertDialog.Root open={scene !== null} onOpenChange={(open) => !open && onclose()}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {scene?.name}?</AlertDialog.Title>
      <AlertDialog.Description>
        The scene preset will be removed. Its MP3 files stay in the Library.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirm}>Delete scene</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
