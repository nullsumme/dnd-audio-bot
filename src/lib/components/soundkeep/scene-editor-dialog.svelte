<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import { Spinner } from '$lib/components/ui/spinner';
  import { Textarea } from '$lib/components/ui/textarea';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { SceneCollection } from '$lib/types';

  let { open = $bindable(false), scene }: { open?: boolean; scene: SceneCollection | null } =
    $props();

  const soundkeep = useSoundkeep();

  let name = $state('');
  let description = $state('');
  let trackIds = $state<string[]>([]);
  let effectIds = $state<string[]>([]);

  $effect(() => {
    if (!open) return;
    name = scene?.name ?? '';
    description = scene?.description ?? '';
    trackIds = [...(scene?.trackIds ?? [])];
    effectIds = [...(scene?.effectIds ?? [])];
  });

  function assign(kind: 'track' | 'effect', id: string, checked: boolean) {
    const current = kind === 'track' ? trackIds : effectIds;
    const next = checked
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((candidate) => candidate !== id);
    if (kind === 'track') trackIds = next;
    else effectIds = next;
  }

  async function save() {
    const input = { name, description, trackIds, effectIds };
    const saved = scene
      ? await soundkeep.updateScene(scene, input)
      : await soundkeep.createScene(input);
    if (saved) open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{scene ? 'Edit scene' : 'Create scene'}</Dialog.Title>
      <Dialog.Description>
        Bundle background tracks and sound effects into a reusable tabletop preset.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group>
      <div class="grid gap-3 sm:grid-cols-2">
        <Field.Field>
          <Field.Label for="scene-name">Name</Field.Label>
          <Input id="scene-name" bind:value={name} maxlength={100} placeholder="Haunted crypt" />
        </Field.Field>
        <Field.Field>
          <Field.Label for="scene-description">Description</Field.Label>
          <Textarea
            id="scene-description"
            bind:value={description}
            maxlength={500}
            rows={2}
            placeholder="The party descends below the chapel…"
          />
        </Field.Field>
      </div>

      <div class="grid min-h-0 gap-3 sm:grid-cols-2">
        <Field.Set>
          <Field.Legend variant="label">Background tracks</Field.Legend>
          <Field.Description>{trackIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-md border">
            <Field.Group class="gap-0.5 p-2">
              {#each soundkeep.backgroundAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-md">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={trackIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) => assign('track', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="metric-label p-3 text-center">No background MP3s.</p>
              {/each}
            </Field.Group>
          </ScrollArea.Root>
        </Field.Set>

        <Field.Set>
          <Field.Legend variant="label">Sound effects</Field.Legend>
          <Field.Description>{effectIds.length} selected</Field.Description>
          <ScrollArea.Root class="mt-2 h-52 rounded-md border">
            <Field.Group class="gap-0.5 p-2">
              {#each soundkeep.soundboardAssets as asset (asset.id)}
                <Field.Label class="hover:bg-muted rounded-md">
                  <Field.Field orientation="horizontal">
                    <Checkbox
                      checked={effectIds.includes(asset.id)}
                      onCheckedChange={(checked: boolean) => assign('effect', asset.id, checked)}
                    />
                    <Field.Content>
                      <Field.Title>{asset.name}</Field.Title>
                      <Field.Description>{asset.category}</Field.Description>
                    </Field.Content>
                  </Field.Field>
                </Field.Label>
              {:else}
                <p class="metric-label p-3 text-center">No soundboard MP3s.</p>
              {/each}
            </Field.Group>
          </ScrollArea.Root>
        </Field.Set>
      </div>
    </Field.Group>

    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button variant="outline" {...props}>Cancel</Button>
        {/snippet}
      </Dialog.Close>
      <Button
        disabled={!name.trim() ||
          trackIds.length + effectIds.length === 0 ||
          soundkeep.busy !== null}
        onclick={save}
      >
        {#if soundkeep.busy === 'create-scene' || soundkeep.busy?.startsWith('edit-scene-')}
          <Spinner data-icon="inline-start" />
        {/if}
        {scene ? 'Save scene' : 'Create scene'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
