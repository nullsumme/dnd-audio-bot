<script lang="ts">
  import { Image, ImageOff } from '@lucide/svelte';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import AssetIconGlyph from '$lib/components/soundkeep/asset-icon.svelte';
  import { ASSET_ICONS, type AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole, AudioAsset } from '$lib/types';

  let { open = $bindable(false), asset }: { open?: boolean; asset: AudioAsset | null } = $props();

  const soundkeep = useSoundkeep();

  let current = $state<AudioAsset | null>(null);
  let name = $state('');
  let category = $state('');
  let role = $state<AssetRole>('ambience');
  let subtitle = $state('');
  let mood = $state('');
  let icon = $state<AssetIcon>('audio-lines');
  let artworkFile = $state<File | null>(null);
  let artworkPreviewUrl = $state<string | null>(null);

  let artworkSource = $derived(
    artworkPreviewUrl ??
      (current?.artworkFilename
        ? `/api/library/${current.id}/artwork?v=${encodeURIComponent(current.updatedAt)}`
        : null)
  );

  $effect(() => {
    if (!open || !asset) return;
    clearArtwork();
    current = asset;
    name = asset.name;
    category = asset.category;
    role = asset.role;
    subtitle = asset.subtitle;
    mood = asset.mood;
    icon = asset.icon;
  });

  function iconLabel(value: AssetIcon) {
    return value
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function clearArtwork() {
    if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
    artworkPreviewUrl = null;
    artworkFile = null;
    const input = document.querySelector<HTMLInputElement>('#edit-artwork');
    if (input) input.value = '';
  }

  function close() {
    open = false;
    clearArtwork();
  }

  function selectArtwork(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      soundkeep.showError(new Error('Artwork must be a PNG or JPEG image.'));
      input.value = '';
      return;
    }
    clearArtwork();
    artworkFile = file;
    artworkPreviewUrl = URL.createObjectURL(file);
  }

  function refreshCurrent(id: string) {
    current = soundkeep.state.assets.find((item) => item.id === id) ?? current;
  }

  async function uploadArtwork() {
    if (!current || !artworkFile) return;
    const id = current.id;
    if (await soundkeep.uploadArtwork(current, artworkFile)) {
      refreshCurrent(id);
      clearArtwork();
    }
  }

  async function removeArtwork() {
    if (!current) return;
    const id = current.id;
    if (await soundkeep.removeArtwork(current)) {
      refreshCurrent(id);
      clearArtwork();
    }
  }

  async function save() {
    if (!current) return;
    const done = await soundkeep.updateAsset(
      current,
      { name, category, role, subtitle, mood, icon },
      'Library entry updated.'
    );
    if (done) close();
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Edit library item</Dialog.Title>
      <Dialog.Description>
        Refine how this MP3 appears in the library, scenes, and soundboard.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group class="gap-3">
      <Field.Set>
        <Field.Legend>Presentation</Field.Legend>
        <Field.Description>Artwork is optional and may be a PNG or JPEG.</Field.Description>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Avatar.Root class="size-20 shrink-0">
            {#if artworkSource}
              <Avatar.Image src={artworkSource} alt="" />
            {/if}
            <Avatar.Fallback><AssetIconGlyph {icon} /></Avatar.Fallback>
          </Avatar.Root>
          <Field.Field class="flex-1">
            <Field.Label for="edit-artwork">Artwork</Field.Label>
            <Input
              id="edit-artwork"
              type="file"
              accept="image/png,image/jpeg"
              disabled={soundkeep.busy !== null}
              onchange={selectArtwork}
            />
            <Field.Description class="text-micro">
              PNG or JPEG, up to the server artwork limit.
            </Field.Description>
            <div class="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={!artworkFile || soundkeep.busy !== null}
                onclick={uploadArtwork}
              >
                {#if soundkeep.busy?.startsWith('artwork-')}
                  <Spinner data-icon="inline-start" />
                {:else}
                  <Image data-icon="inline-start" />
                {/if}
                Save artwork
              </Button>
              {#if current?.artworkFilename}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={soundkeep.busy !== null}
                  onclick={removeArtwork}
                >
                  <ImageOff data-icon="inline-start" />
                  Remove artwork
                </Button>
              {/if}
            </div>
          </Field.Field>
        </div>
      </Field.Set>

      <Field.Separator />

      <Field.Set>
        <Field.Legend>Metadata</Field.Legend>
        <Field.Description>
          These labels make large sound libraries easier to scan and search.
        </Field.Description>
        <Field.Group class="gap-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="edit-name">Display name</Field.Label>
              <Input id="edit-name" class="h-8" bind:value={name} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-category">Category</Field.Label>
              <Input id="edit-category" class="h-8" bind:value={category} />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="edit-subtitle">Subtitle</Field.Label>
            <Input
              id="edit-subtitle"
              class="h-8"
              placeholder="Short descriptive line"
              bind:value={subtitle}
            />
          </Field.Field>
          <div class="grid gap-3 sm:grid-cols-3">
            <Field.Field>
              <Field.Label for="edit-mood">Mood</Field.Label>
              <Input id="edit-mood" class="h-8" placeholder="e.g. Ominous" bind:value={mood} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-icon">Icon</Field.Label>
              <Select.Root type="single" bind:value={icon}>
                <Select.Trigger id="edit-icon" class="h-8 w-full">
                  <span>{iconLabel(icon)}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {#each ASSET_ICONS as value (value)}
                      <Select.Item {value}>{iconLabel(value)}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-role">Placement</Field.Label>
              <Select.Root type="single" bind:value={role}>
                <Select.Trigger id="edit-role" class="h-8 w-full">
                  <span>{role === 'ambience' ? 'Background' : 'Soundboard'}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Item value="ambience">Background</Select.Item>
                    <Select.Item value="soundboard">Soundboard</Select.Item>
                  </Select.Group>
                </Select.Content>
              </Select.Root>
            </Field.Field>
          </div>
        </Field.Group>
      </Field.Set>
    </Field.Group>

    <Dialog.Footer>
      <Button variant="outline" onclick={close}>Cancel</Button>
      <Button disabled={!name.trim() || soundkeep.busy !== null} onclick={save}>
        {#if soundkeep.busy?.startsWith('edit-')}<Spinner data-icon="inline-start" />{/if}
        Save changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
