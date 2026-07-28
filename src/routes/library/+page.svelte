<script lang="ts">
  import {
    Cloud,
    Download,
    ExternalLink,
    FileAudio,
    HardDrive,
    Pencil,
    Play,
    Plus,
    Search,
    Trash2,
    Upload,
    X
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Table from '$lib/components/ui/table';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole, AudioAsset } from '$lib/types';
  import { formatBytes, formatDuration } from '$lib/utils';

  const soundkeep = useSoundkeep();

  let librarySearch = $state('');
  let libraryTab = $state('upload');

  let uploadFile = $state<File | null>(null);
  let uploadName = $state('');
  let uploadCategory = $state('');
  let uploadRole = $state<AssetRole>('ambience');

  let youtubeUrl = $state('');
  let youtubeName = $state('');
  let youtubeCategory = $state('');
  let youtubeRole = $state<AssetRole>('ambience');
  let youtubeMode = $state<'live' | 'saved'>('live');

  let editOpen = $state(false);
  let editingAsset = $state<AudioAsset | null>(null);
  let editName = $state('');
  let editCategory = $state('');
  let editRole = $state<AssetRole>('ambience');

  let deleteOpen = $state(false);
  let deletingAsset = $state<AudioAsset | null>(null);

  let filteredAssets = $derived(
    soundkeep.state.assets.filter((asset) => {
      const query = librarySearch.trim().toLowerCase();
      return (
        !query ||
        asset.name.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query) ||
        soundkeep.sourceTypeLabel(asset.sourceType).toLowerCase().includes(query)
      );
    })
  );

  async function uploadAsset() {
    if (!uploadFile) {
      soundkeep.showError(new Error('Choose an MP3 file first.'));
      return;
    }
    const form = new FormData();
    form.set('file', uploadFile);
    form.set('name', uploadName);
    form.set('category', uploadCategory);
    form.set('role', uploadRole);
    const completed = await soundkeep.uploadAsset(form, uploadName || uploadFile.name);
    if (completed) {
      uploadFile = null;
      uploadName = '';
      uploadCategory = '';
      const input = document.querySelector<HTMLInputElement>('#audio-upload');
      if (input) input.value = '';
    }
  }

  async function addYouTubeAsset() {
    if (!youtubeUrl.trim()) return;
    const completed = await soundkeep.addYouTubeAsset({
      url: youtubeUrl,
      mode: youtubeMode,
      name: youtubeName,
      category: youtubeCategory,
      role: youtubeRole
    });
    if (completed) {
      youtubeUrl = '';
      youtubeName = '';
      youtubeCategory = '';
    }
  }

  function beginEdit(asset: AudioAsset) {
    editingAsset = asset;
    editName = asset.name;
    editCategory = asset.category;
    editRole = asset.role;
    editOpen = true;
  }

  async function saveEdit() {
    if (!editingAsset) return;
    const completed = await soundkeep.updateAsset(
      editingAsset,
      { name: editName, category: editCategory, role: editRole },
      'Library entry updated.'
    );
    if (completed) editOpen = false;
  }

  function beginDelete(asset: AudioAsset) {
    deletingAsset = asset;
    deleteOpen = true;
  }

  async function confirmDelete() {
    if (!deletingAsset) return;
    const completed = await soundkeep.deleteAsset(deletingAsset);
    if (completed) {
      deleteOpen = false;
      deletingAsset = null;
    }
  }
</script>

<div class="flex flex-1 flex-col gap-6 p-4 md:p-6">
  <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-semibold tracking-tight">Audio library</h1>
      <p class="text-muted-foreground text-sm">
        Import, organize, preview, and place audio on the control surface.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Badge variant="outline">{soundkeep.state.assets.length} assets</Badge>
      <Badge variant="outline">{formatBytes(soundkeep.totalLocalBytes)} local</Badge>
    </div>
  </div>

  <div class="grid gap-6 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,2fr)]">
    <Card.Root>
      <Card.Header>
        <Card.Title>Add audio</Card.Title>
        <Card.Description>Upload an MP3 or register a YouTube source.</Card.Description>
      </Card.Header>
      <Card.Content>
        <Tabs.Root bind:value={libraryTab}>
          <Tabs.List class="grid w-full grid-cols-2">
            <Tabs.Trigger value="upload"><Upload />MP3 upload</Tabs.Trigger>
            <Tabs.Trigger value="youtube"><Cloud />YouTube</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="upload" class="pt-4">
            <form
              onsubmit={(event) => {
                event.preventDefault();
                void uploadAsset();
              }}
            >
              <Field.Group>
                <Field.Field>
                  <Field.Label for="audio-upload">MP3 file</Field.Label>
                  <Input
                    id="audio-upload"
                    type="file"
                    accept=".mp3,audio/mpeg"
                    onchange={(event) =>
                      (uploadFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null)}
                  />
                  <Field.Description>Stored locally and streamed through FFmpeg.</Field.Description>
                </Field.Field>
                <Field.Field>
                  <Field.Label for="upload-name">Display name</Field.Label>
                  <Input
                    id="upload-name"
                    placeholder="e.g. Distant thunder"
                    bind:value={uploadName}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="upload-category">Category</Field.Label>
                  <Input
                    id="upload-category"
                    placeholder="e.g. Weather"
                    bind:value={uploadCategory}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="upload-role">Default placement</Field.Label>
                  <Select.Root type="single" bind:value={uploadRole}>
                    <Select.Trigger id="upload-role" class="w-full">
                      <span>{uploadRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="ambience">Background</Select.Item>
                        <Select.Item value="soundboard">Soundboard</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select.Root>
                </Field.Field>
                <Button type="submit" disabled={!uploadFile || soundkeep.busy !== null}>
                  {#if soundkeep.busy === 'upload'}
                    <Spinner data-icon="inline-start" />
                    Uploading
                  {:else}
                    <Upload data-icon="inline-start" />
                    Add MP3
                  {/if}
                </Button>
              </Field.Group>
            </form>
          </Tabs.Content>

          <Tabs.Content value="youtube" class="pt-4">
            <form
              onsubmit={(event) => {
                event.preventDefault();
                void addYouTubeAsset();
              }}
            >
              <Field.Group>
                <Field.Field>
                  <Field.Label for="youtube-url">YouTube URL</Field.Label>
                  <Input
                    id="youtube-url"
                    type="url"
                    placeholder="https://youtube.com/watch?v=…"
                    bind:value={youtubeUrl}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label id="youtube-mode-label">Storage type</Field.Label>
                  <ToggleGroup.Root
                    type="single"
                    variant="outline"
                    spacing={2}
                    class="w-full"
                    aria-labelledby="youtube-mode-label"
                    bind:value={youtubeMode}
                  >
                    <ToggleGroup.Item value="live" class="flex-1">
                      <Cloud />
                      Live stream
                    </ToggleGroup.Item>
                    <ToggleGroup.Item value="saved" class="flex-1">
                      <Download />
                      Save MP3
                    </ToggleGroup.Item>
                  </ToggleGroup.Root>
                  <Field.Description>
                    {youtubeMode === 'live'
                      ? 'Resolved each time it plays.'
                      : 'Downloaded once to local storage.'}
                  </Field.Description>
                </Field.Field>
                <Field.Field>
                  <Field.Label for="youtube-name">Display name</Field.Label>
                  <Input
                    id="youtube-name"
                    placeholder="Uses the YouTube title"
                    bind:value={youtubeName}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="youtube-category">Category</Field.Label>
                  <Input
                    id="youtube-category"
                    placeholder="e.g. Taverns"
                    bind:value={youtubeCategory}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="youtube-role">Default placement</Field.Label>
                  <Select.Root type="single" bind:value={youtubeRole}>
                    <Select.Trigger id="youtube-role" class="w-full">
                      <span>{youtubeRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="ambience">Background</Select.Item>
                        <Select.Item value="soundboard">Soundboard</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select.Root>
                </Field.Field>
                <Button type="submit" disabled={!youtubeUrl.trim() || soundkeep.busy !== null}>
                  {#if soundkeep.busy === 'youtube'}
                    <Spinner data-icon="inline-start" />
                    {youtubeMode === 'saved' ? 'Downloading' : 'Resolving'}
                  {:else if youtubeMode === 'saved'}
                    <Download data-icon="inline-start" />
                    Save to library
                  {:else}
                    <Cloud data-icon="inline-start" />
                    Add live stream
                  {/if}
                </Button>
              </Field.Group>
            </form>
          </Tabs.Content>
        </Tabs.Root>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Card.Title>Assets</Card.Title>
            <Card.Description>All audio available to this Soundkeep instance.</Card.Description>
          </div>
          <InputGroup.Root class="w-full lg:max-w-sm">
            <InputGroup.Addon><Search /></InputGroup.Addon>
            <InputGroup.Input
              aria-label="Search library"
              placeholder="Search name, category, or source…"
              bind:value={librarySearch}
            />
          </InputGroup.Root>
        </div>
      </Card.Header>
      <Card.Content>
        {#if filteredAssets.length === 0}
          <Empty.Root>
            <Empty.Header>
              <Empty.Media variant="icon"><FileAudio /></Empty.Media>
              <Empty.Title>
                {soundkeep.state.assets.length ? 'No matching audio' : 'Library is empty'}
              </Empty.Title>
              <Empty.Description>
                {soundkeep.state.assets.length
                  ? 'Try a broader search.'
                  : 'Upload an MP3 or add a YouTube source to get started.'}
              </Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>Asset</Table.Head>
                <Table.Head>Source</Table.Head>
                <Table.Head>Placement</Table.Head>
                <Table.Head>Duration</Table.Head>
                <Table.Head class="text-right">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each filteredAssets as asset (asset.id)}
                <Table.Row>
                  <Table.Cell>
                    <div class="flex min-w-0 items-center gap-3">
                      <div
                        class="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg"
                      >
                        {#if asset.sourceType === 'youtube-live'}
                          <Cloud />
                        {:else if asset.sourceType === 'youtube-saved'}
                          <Download />
                        {:else}
                          <FileAudio />
                        {/if}
                      </div>
                      <div class="min-w-0">
                        <p class="max-w-64 truncate font-medium">{asset.name}</p>
                        <p class="text-muted-foreground text-xs">{asset.category}</p>
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div class="flex flex-col gap-1">
                      <span>{soundkeep.sourceTypeLabel(asset.sourceType)}</span>
                      <span class="text-muted-foreground text-xs">
                        {asset.filename ? formatBytes(asset.size) : 'Remote'}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge variant={asset.role === 'soundboard' ? 'secondary' : 'outline'}>
                      {asset.role === 'soundboard' ? 'Soundboard' : 'Background'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{formatDuration(asset.duration)}</Table.Cell>
                  <Table.Cell>
                    <div class="flex justify-end gap-1">
                      {#if asset.filename}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Preview ${asset.name}`}
                          onclick={() => soundkeep.preview(asset)}
                        >
                          <Play />
                        </Button>
                      {:else if asset.youtubeUrl}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Open ${asset.name} on YouTube`}
                          href={asset.youtubeUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink />
                        </Button>
                      {/if}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={asset.role === 'soundboard'
                          ? `Remove ${asset.name} from soundboard`
                          : `Add ${asset.name} to soundboard`}
                        disabled={soundkeep.busy !== null}
                        onclick={() =>
                          soundkeep.setAssetRole(
                            asset,
                            asset.role === 'soundboard' ? 'ambience' : 'soundboard'
                          )}
                      >
                        {#if asset.role === 'soundboard'}<X />{:else}<Plus />{/if}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${asset.name}`}
                        onclick={() => beginEdit(asset)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${asset.name}`}
                        onclick={() => beginDelete(asset)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <HardDrive />
        Storage overview
      </Card.Title>
      <Card.Description>Local files persist in the configured audio volume.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4 md:grid-cols-3">
      <div>
        <p class="text-muted-foreground text-xs">Local storage</p>
        <p class="mt-1 text-lg font-semibold">{formatBytes(soundkeep.totalLocalBytes)}</p>
      </div>
      <div>
        <p class="text-muted-foreground text-xs">Background assets</p>
        <p class="mt-1 text-lg font-semibold">{soundkeep.backgroundAssets.length}</p>
      </div>
      <div>
        <p class="text-muted-foreground text-xs">Soundboard buttons</p>
        <p class="mt-1 text-lg font-semibold">{soundkeep.soundboardAssets.length}</p>
      </div>
    </Card.Content>
  </Card.Root>
</div>

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Edit library item</Dialog.Title>
      <Dialog.Description>
        Change its label, category, or control-surface placement.
      </Dialog.Description>
    </Dialog.Header>
    <Field.Group>
      <Field.Field>
        <Field.Label for="edit-name">Display name</Field.Label>
        <Input id="edit-name" bind:value={editName} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="edit-category">Category</Field.Label>
        <Input id="edit-category" bind:value={editCategory} />
      </Field.Field>
      <Field.Field>
        <Field.Label for="edit-role">Placement</Field.Label>
        <Select.Root type="single" bind:value={editRole}>
          <Select.Trigger id="edit-role" class="w-full">
            <span>{editRole === 'ambience' ? 'Background' : 'Soundboard'}</span>
          </Select.Trigger>
          <Select.Content>
            <Select.Group>
              <Select.Item value="ambience">Background</Select.Item>
              <Select.Item value="soundboard">Soundboard</Select.Item>
            </Select.Group>
          </Select.Content>
        </Select.Root>
      </Field.Field>
    </Field.Group>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
      <Button disabled={!editName.trim() || soundkeep.busy !== null} onclick={saveEdit}>
        {#if soundkeep.busy?.startsWith('edit-')}<Spinner data-icon="inline-start" />{/if}
        Save changes
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{deletingAsset?.name}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the library entry and its saved MP3, if present. This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        variant="destructive"
        disabled={!deletingAsset || soundkeep.busy !== null}
        onclick={confirmDelete}
      >
        {#if soundkeep.busy?.startsWith('delete-')}<Spinner data-icon="inline-start" />{/if}
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
