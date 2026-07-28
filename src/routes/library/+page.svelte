<script lang="ts">
  import type { Component } from 'svelte';
  import {
    AudioLines,
    Bell,
    CheckCircle2,
    CircleAlert,
    CircleDashed,
    CloudLightning,
    DoorOpen,
    FileAudio,
    Flame,
    HardDrive,
    Image,
    ImageOff,
    ListFilter,
    LoaderCircle,
    Music,
    Pencil,
    Play,
    Plus,
    Search,
    Skull,
    Sparkles,
    Swords,
    Trash2,
    Upload,
    Waves,
    Wind,
    X,
    Zap
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Avatar from '$lib/components/ui/avatar';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Empty from '$lib/components/ui/empty';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import * as InputGroup from '$lib/components/ui/input-group';
  import { Progress } from '$lib/components/ui/progress';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Table from '$lib/components/ui/table';
  import { ASSET_ICONS, type AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole, AudioAsset } from '$lib/types';
  import { cn, formatBytes, formatDuration } from '$lib/utils';

  type UploadStatus = 'queued' | 'uploading' | 'success' | 'error';
  type RoleFilter = 'all' | AssetRole;

  interface UploadQueueItem {
    id: string;
    file: File;
    suggestedName: string;
    status: UploadStatus;
    error: string;
  }

  const soundkeep = useSoundkeep();

  const assetIconComponents: Record<AssetIcon, Component> = {
    'audio-lines': AudioLines,
    bell: Bell,
    'cloud-lightning': CloudLightning,
    'door-open': DoorOpen,
    flame: Flame,
    music: Music,
    skull: Skull,
    sparkles: Sparkles,
    swords: Swords,
    waves: Waves,
    wind: Wind,
    zap: Zap
  };

  let librarySearch = $state('');
  let libraryRole = $state<RoleFilter>('all');

  let uploadQueue = $state<UploadQueueItem[]>([]);
  let uploadName = $state('');
  let uploadCategory = $state('Imported');
  let uploadRole = $state<AssetRole>('ambience');
  let uploadSubtitle = $state('');
  let uploadMood = $state('');
  let uploadIcon = $state<AssetIcon>('audio-lines');
  let batchUploading = $state(false);
  let dragActive = $state(false);

  let editOpen = $state(false);
  let editingAsset = $state<AudioAsset | null>(null);
  let editName = $state('');
  let editCategory = $state('');
  let editRole = $state<AssetRole>('ambience');
  let editSubtitle = $state('');
  let editMood = $state('');
  let editIcon = $state<AssetIcon>('audio-lines');
  let artworkFile = $state<File | null>(null);
  let artworkPreviewUrl = $state<string | null>(null);

  let deleteOpen = $state(false);
  let deletingAsset = $state<AudioAsset | null>(null);

  let filteredAssets = $derived(
    soundkeep.state.assets.filter((asset) => {
      const query = librarySearch.trim().toLowerCase();
      const matchesRole = libraryRole === 'all' || asset.role === libraryRole;
      const matchesSearch =
        !query ||
        asset.name.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query) ||
        asset.subtitle.toLowerCase().includes(query) ||
        asset.mood.toLowerCase().includes(query);
      return matchesRole && matchesSearch;
    })
  );

  let completedUploads = $derived(
    uploadQueue.filter((item) => item.status === 'success' || item.status === 'error').length
  );
  let pendingUploads = $derived(
    uploadQueue.filter((item) => item.status === 'queued' || item.status === 'error').length
  );
  let uploadProgress = $derived(
    uploadQueue.length === 0 ? 0 : Math.round((completedUploads / uploadQueue.length) * 100)
  );
  let artworkSource = $derived(
    artworkPreviewUrl ??
      (editingAsset?.artworkFilename
        ? `/api/library/${editingAsset.id}/artwork?v=${encodeURIComponent(editingAsset.updatedAt)}`
        : null)
  );

  function humanizeFilename(filename: string) {
    const withoutExtension = filename.replace(/\.mp3$/i, '');
    const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spaced) return 'Untitled sound';
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function iconLabel(icon: AssetIcon) {
    return icon
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function statusLabel(status: UploadStatus) {
    if (status === 'uploading') return 'Uploading';
    if (status === 'success') return 'Added';
    if (status === 'error') return 'Failed';
    return 'Queued';
  }

  function isMp3(file: File) {
    return file.name.toLowerCase().endsWith('.mp3');
  }

  function addFiles(files: File[]) {
    if (batchUploading) return;
    const mp3Files = files.filter(isMp3);
    if (mp3Files.length !== files.length) {
      soundkeep.showError(new Error('Only .mp3 files can be added to Soundkeep.'));
    }
    if (mp3Files.length === 0) return;

    const existing = new Set(
      uploadQueue.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`)
    );
    const additions = mp3Files
      .filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        suggestedName: humanizeFilename(file.name),
        status: 'queued' as const,
        error: ''
      }));

    uploadQueue.push(...additions);
    uploadName = uploadQueue.length === 1 ? uploadQueue[0].suggestedName : '';

    const input = document.querySelector<HTMLInputElement>('#audio-upload');
    if (input) input.value = '';
  }

  function handleFileInput(event: Event) {
    addFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []));
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function removeQueuedUpload(id: string) {
    if (batchUploading) return;
    uploadQueue = uploadQueue.filter((item) => item.id !== id);
    uploadName = uploadQueue.length === 1 ? uploadQueue[0].suggestedName : '';
  }

  function clearCompletedUploads() {
    if (batchUploading) return;
    uploadQueue = uploadQueue.filter(
      (item) => item.status !== 'success' && item.status !== 'error'
    );
    uploadName = uploadQueue.length === 1 ? uploadQueue[0].suggestedName : '';
  }

  async function uploadAssets() {
    const uploadable = uploadQueue.filter(
      (item) => item.status === 'queued' || item.status === 'error'
    );
    if (uploadable.length === 0) {
      soundkeep.showError(new Error('Choose one or more MP3 files first.'));
      return;
    }

    batchUploading = true;
    const singleUpload = uploadQueue.length === 1;
    for (const item of uploadable) {
      item.status = 'uploading';
      item.error = '';
      const displayName =
        singleUpload && uploadName.trim() ? uploadName.trim() : item.suggestedName;
      const completed = await soundkeep.uploadAsset(
        item.file,
        {
          name: displayName,
          category: uploadCategory.trim(),
          role: uploadRole,
          subtitle: uploadSubtitle.trim(),
          mood: uploadMood.trim(),
          icon: uploadIcon
        },
        displayName,
        singleUpload
      );
      item.status = completed ? 'success' : 'error';
      item.error = completed ? '' : 'Upload failed. You can retry this file.';
    }
    batchUploading = false;
  }

  function clearArtworkSelection() {
    if (artworkPreviewUrl) URL.revokeObjectURL(artworkPreviewUrl);
    artworkPreviewUrl = null;
    artworkFile = null;
    const input = document.querySelector<HTMLInputElement>('#edit-artwork');
    if (input) input.value = '';
  }

  function beginEdit(asset: AudioAsset) {
    clearArtworkSelection();
    editingAsset = asset;
    editName = asset.name;
    editCategory = asset.category;
    editRole = asset.role;
    editSubtitle = asset.subtitle;
    editMood = asset.mood;
    editIcon = asset.icon;
    editOpen = true;
  }

  function closeEdit() {
    editOpen = false;
    clearArtworkSelection();
  }

  async function saveEdit() {
    if (!editingAsset) return;
    const completed = await soundkeep.updateAsset(
      editingAsset,
      {
        name: editName,
        category: editCategory,
        role: editRole,
        subtitle: editSubtitle,
        mood: editMood,
        icon: editIcon
      },
      'Library entry updated.'
    );
    if (completed) closeEdit();
  }

  function selectArtwork(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    if (!file) return;
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      soundkeep.showError(new Error('Artwork must be a PNG or JPEG image.'));
      (event.currentTarget as HTMLInputElement).value = '';
      return;
    }
    clearArtworkSelection();
    artworkFile = file;
    artworkPreviewUrl = URL.createObjectURL(file);
  }

  async function uploadArtwork() {
    if (!editingAsset || !artworkFile) return;
    const assetId = editingAsset.id;
    const completed = await soundkeep.uploadArtwork(editingAsset, artworkFile);
    if (completed) {
      editingAsset = soundkeep.state.assets.find((asset) => asset.id === assetId) ?? editingAsset;
      clearArtworkSelection();
    }
  }

  async function removeArtwork() {
    if (!editingAsset) return;
    const assetId = editingAsset.id;
    const completed = await soundkeep.removeArtwork(editingAsset);
    if (completed) {
      editingAsset = soundkeep.state.assets.find((asset) => asset.id === assetId) ?? editingAsset;
      clearArtworkSelection();
    }
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
        Upload MP3s, shape their presentation, and organize the session control surface.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{soundkeep.state.assets.length} assets</Badge>
      <Badge variant="outline">{formatBytes(soundkeep.totalLocalBytes)} local</Badge>
    </div>
  </div>

  <div class="grid items-start gap-6 2xl:grid-cols-[minmax(380px,0.8fr)_minmax(0,2fr)]">
    <div class="flex flex-col gap-6">
      <Card.Root>
        <Card.Header>
          <Card.Title>Add MP3s</Card.Title>
          <Card.Description>
            Drop a batch here or choose files. Uploads are processed one at a time.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void uploadAssets();
            }}
          >
            <Field.Group>
              <Field.Field>
                <Field.Label for="audio-upload">MP3 files</Field.Label>
                <div
                  role="region"
                  aria-label="MP3 upload drop zone"
                  class={cn(
                    'bg-muted/30 flex flex-col items-center gap-3 rounded-xl border border-dashed p-5 text-center transition-colors',
                    dragActive && 'bg-accent border-primary'
                  )}
                  ondragenter={(event) => {
                    event.preventDefault();
                    dragActive = true;
                  }}
                  ondragover={(event) => {
                    event.preventDefault();
                    dragActive = true;
                  }}
                  ondragleave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                      dragActive = false;
                    }
                  }}
                  ondrop={handleDrop}
                >
                  <div class="bg-background grid size-11 place-items-center rounded-full border">
                    <Upload />
                  </div>
                  <div class="flex flex-col gap-1">
                    <p class="font-medium">Drop MP3 files here</p>
                    <p class="text-muted-foreground text-xs">
                      Or choose one or several files from this device.
                    </p>
                  </div>
                  <Input
                    id="audio-upload"
                    type="file"
                    accept=".mp3,audio/mpeg"
                    multiple
                    disabled={batchUploading}
                    onchange={handleFileInput}
                  />
                </div>
                <Field.Description>
                  Only MP3 audio is accepted. Short sound effects are prewarmed for fast playback.
                </Field.Description>
              </Field.Field>

              {#if uploadQueue.length > 0}
                <Field.Field>
                  <div class="flex items-center justify-between gap-3">
                    <Field.Label>Upload queue</Field.Label>
                    {#if completedUploads > 0 && !batchUploading}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onclick={clearCompletedUploads}
                      >
                        Clear finished
                      </Button>
                    {/if}
                  </div>
                  <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between text-xs">
                      <span class="text-muted-foreground">
                        {completedUploads} of {uploadQueue.length} processed
                      </span>
                      <span class="font-medium">{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} aria-label="Overall upload progress" />
                  </div>
                  <ScrollArea.Root class="h-44 rounded-lg border">
                    <div class="flex flex-col gap-1 p-2">
                      {#each uploadQueue as item (item.id)}
                        <div class="flex min-w-0 items-center gap-3 rounded-md px-2 py-2">
                          <div class="text-muted-foreground shrink-0">
                            {#if item.status === 'uploading'}
                              <LoaderCircle class="animate-spin" />
                            {:else if item.status === 'success'}
                              <CheckCircle2 />
                            {:else if item.status === 'error'}
                              <CircleAlert />
                            {:else}
                              <CircleDashed />
                            {/if}
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">{item.suggestedName}</p>
                            <p class="text-muted-foreground truncate text-xs">
                              {item.error ||
                                `${formatBytes(item.file.size)} · ${statusLabel(item.status)}`}
                            </p>
                          </div>
                          <Badge variant={item.status === 'error' ? 'warning' : 'outline'}>
                            {statusLabel(item.status)}
                          </Badge>
                          {#if item.status !== 'uploading'}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Remove ${item.file.name} from upload queue`}
                              disabled={batchUploading}
                              onclick={() => removeQueuedUpload(item.id)}
                            >
                              <X />
                            </Button>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </ScrollArea.Root>
                </Field.Field>
              {/if}

              <Field.Field data-disabled={uploadQueue.length !== 1}>
                <Field.Label for="upload-name">Display name</Field.Label>
                <Input
                  id="upload-name"
                  placeholder={uploadQueue.length > 1
                    ? 'Each file uses its filename'
                    : 'e.g. Distant thunder'}
                  disabled={uploadQueue.length !== 1 || batchUploading}
                  bind:value={uploadName}
                />
                <Field.Description>
                  {uploadQueue.length > 1
                    ? 'Batch uploads receive readable names from their filenames.'
                    : 'The MP3 filename is converted into a readable default.'}
                </Field.Description>
              </Field.Field>

              <div class="grid gap-4 sm:grid-cols-2">
                <Field.Field>
                  <Field.Label for="upload-category">Category</Field.Label>
                  <Input
                    id="upload-category"
                    placeholder="e.g. Weather"
                    disabled={batchUploading}
                    bind:value={uploadCategory}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="upload-role">Placement</Field.Label>
                  <Select.Root type="single" disabled={batchUploading} bind:value={uploadRole}>
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
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <Field.Field>
                  <Field.Label for="upload-mood">Mood</Field.Label>
                  <Input
                    id="upload-mood"
                    placeholder="e.g. Ominous"
                    disabled={batchUploading}
                    bind:value={uploadMood}
                  />
                </Field.Field>
                <Field.Field>
                  <Field.Label for="upload-icon">Icon</Field.Label>
                  <Select.Root type="single" disabled={batchUploading} bind:value={uploadIcon}>
                    <Select.Trigger id="upload-icon" class="w-full">
                      <span>{iconLabel(uploadIcon)}</span>
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {#each ASSET_ICONS as icon}
                          <Select.Item value={icon}>{iconLabel(icon)}</Select.Item>
                        {/each}
                      </Select.Group>
                    </Select.Content>
                  </Select.Root>
                </Field.Field>
              </div>

              <Field.Field>
                <Field.Label for="upload-subtitle">Subtitle</Field.Label>
                <Input
                  id="upload-subtitle"
                  placeholder="Optional short description"
                  disabled={batchUploading}
                  bind:value={uploadSubtitle}
                />
              </Field.Field>

              <Button
                type="submit"
                disabled={pendingUploads === 0 || batchUploading || soundkeep.busy !== null}
              >
                {#if batchUploading}
                  <Spinner data-icon="inline-start" />
                  Uploading {Math.min(completedUploads + 1, uploadQueue.length)} of
                  {uploadQueue.length}
                {:else}
                  <Upload data-icon="inline-start" />
                  {uploadQueue.length === 0
                    ? 'Add MP3s'
                    : uploadQueue.length === 1
                      ? 'Add MP3'
                      : `Add ${pendingUploads} MP3s`}
                {/if}
              </Button>
            </Field.Group>
          </form>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2">
            <HardDrive />
            Storage overview
          </Card.Title>
          <Card.Description>Audio and artwork persist in the configured volume.</Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-4 sm:grid-cols-3 2xl:grid-cols-1">
          <div>
            <p class="text-muted-foreground text-xs">Local audio</p>
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

    <Card.Root class="min-w-0">
      <Card.Header>
        <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Card.Title>Assets</Card.Title>
            <Card.Description>
              Search, preview, classify, and customize every uploaded MP3.
            </Card.Description>
          </div>
          <div class="flex w-full flex-col gap-2 sm:flex-row xl:max-w-xl">
            <InputGroup.Root class="min-w-0 flex-1">
              <InputGroup.Addon><Search /></InputGroup.Addon>
              <InputGroup.Input
                aria-label="Search library"
                placeholder="Search name, category, mood…"
                bind:value={librarySearch}
              />
            </InputGroup.Root>
            <Select.Root type="single" bind:value={libraryRole}>
              <Select.Trigger aria-label="Filter library by placement" class="w-full sm:w-40">
                <ListFilter />
                <span>
                  {libraryRole === 'all'
                    ? 'All placements'
                    : libraryRole === 'ambience'
                      ? 'Background'
                      : 'Soundboard'}
                </span>
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="all">All placements</Select.Item>
                  <Select.Item value="ambience">Background</Select.Item>
                  <Select.Item value="soundboard">Soundboard</Select.Item>
                </Select.Group>
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </Card.Header>
      <Card.Content>
        {#if filteredAssets.length === 0}
          <Empty.Root>
            <Empty.Header>
              <Empty.Media variant="icon"><FileAudio /></Empty.Media>
              <Empty.Title>
                {soundkeep.state.assets.length ? 'No matching MP3s' : 'Library is empty'}
              </Empty.Title>
              <Empty.Description>
                {soundkeep.state.assets.length
                  ? 'Try a broader search or another placement.'
                  : 'Upload an MP3 to get started.'}
              </Empty.Description>
            </Empty.Header>
          </Empty.Root>
        {:else}
          <ScrollArea.Root orientation="horizontal" class="w-full">
            <Table.Root class="min-w-[800px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Asset</Table.Head>
                  <Table.Head>Metadata</Table.Head>
                  <Table.Head>Placement</Table.Head>
                  <Table.Head>Duration</Table.Head>
                  <Table.Head class="text-right">Actions</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each filteredAssets as asset (asset.id)}
                  {@const AssetIconComponent = assetIconComponents[asset.icon] ?? FileAudio}
                  <Table.Row>
                    <Table.Cell>
                      <div class="flex min-w-0 items-center gap-3">
                        <Avatar.Root class="size-11 shrink-0">
                          {#if asset.artworkFilename}
                            <Avatar.Image
                              src={`/api/library/${asset.id}/artwork?v=${encodeURIComponent(asset.updatedAt)}`}
                              alt=""
                            />
                          {/if}
                          <Avatar.Fallback><AssetIconComponent /></Avatar.Fallback>
                        </Avatar.Root>
                        <div class="min-w-0">
                          <p class="max-w-56 truncate font-medium">{asset.name}</p>
                          <p class="text-muted-foreground max-w-56 truncate text-xs">
                            {asset.subtitle || asset.originalFilename}
                          </p>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <div class="flex max-w-48 flex-wrap items-center gap-1">
                        <Badge variant="outline">{asset.category || 'Uncategorized'}</Badge>
                        {#if asset.mood}
                          <Badge variant="secondary">{asset.mood}</Badge>
                        {/if}
                        <span class="text-muted-foreground w-full text-xs">
                          {formatBytes(asset.size)}
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
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Preview ${asset.name}`}
                          onclick={() => soundkeep.preview(asset)}
                        >
                          <Play />
                        </Button>
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
          </ScrollArea.Root>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Edit library item</Dialog.Title>
      <Dialog.Description>
        Refine how this MP3 appears in the library, scenes, and soundboard.
      </Dialog.Description>
    </Dialog.Header>

    <Field.Group>
      <Field.Set>
        <Field.Legend>Presentation</Field.Legend>
        <Field.Description>Artwork is optional and may be a PNG or JPEG.</Field.Description>
        <Field.Group>
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar.Root class="size-24 shrink-0">
              {#if artworkSource}
                <Avatar.Image src={artworkSource} alt="" />
              {/if}
              <Avatar.Fallback>
                {#if editingAsset}
                  {@const EditingIcon = assetIconComponents[editIcon] ?? Image}
                  <EditingIcon />
                {:else}
                  <Image />
                {/if}
              </Avatar.Fallback>
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
              <Field.Description>PNG or JPEG, up to the server artwork limit.</Field.Description>
              <div class="flex flex-wrap gap-2">
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
                {#if editingAsset?.artworkFilename}
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
        </Field.Group>
      </Field.Set>

      <Field.Separator />

      <Field.Set>
        <Field.Legend>Metadata</Field.Legend>
        <Field.Description>
          These labels make large sound libraries easier to scan and search.
        </Field.Description>
        <Field.Group>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field.Field>
              <Field.Label for="edit-name">Display name</Field.Label>
              <Input id="edit-name" bind:value={editName} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-category">Category</Field.Label>
              <Input id="edit-category" bind:value={editCategory} />
            </Field.Field>
          </div>
          <Field.Field>
            <Field.Label for="edit-subtitle">Subtitle</Field.Label>
            <Input
              id="edit-subtitle"
              placeholder="Short descriptive line"
              bind:value={editSubtitle}
            />
          </Field.Field>
          <div class="grid gap-4 sm:grid-cols-3">
            <Field.Field>
              <Field.Label for="edit-mood">Mood</Field.Label>
              <Input id="edit-mood" placeholder="e.g. Ominous" bind:value={editMood} />
            </Field.Field>
            <Field.Field>
              <Field.Label for="edit-icon">Icon</Field.Label>
              <Select.Root type="single" bind:value={editIcon}>
                <Select.Trigger id="edit-icon" class="w-full">
                  <span>{iconLabel(editIcon)}</span>
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {#each ASSET_ICONS as icon}
                      <Select.Item value={icon}>{iconLabel(icon)}</Select.Item>
                    {/each}
                  </Select.Group>
                </Select.Content>
              </Select.Root>
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
          </div>
        </Field.Group>
      </Field.Set>
    </Field.Group>

    <Dialog.Footer>
      <Button variant="outline" onclick={closeEdit}>Cancel</Button>
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
        This removes the library entry, saved MP3, artwork, and scene references. This cannot be
        undone.
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
