<script lang="ts">
  import { CheckCircle2, CircleAlert, CircleDashed, LoaderCircle, Upload, X } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Input } from '$lib/components/ui/input';
  import { Progress } from '$lib/components/ui/progress';
  import * as ScrollArea from '$lib/components/ui/scroll-area';
  import * as Select from '$lib/components/ui/select';
  import { Spinner } from '$lib/components/ui/spinner';
  import { ASSET_ICONS, type AssetIcon } from '$lib/asset-metadata';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';
  import type { AssetRole } from '$lib/types';
  import { cn, formatBytes } from '$lib/utils';

  type UploadStatus = 'queued' | 'uploading' | 'success' | 'error';

  interface UploadQueueItem {
    id: string;
    file: File;
    suggestedName: string;
    status: UploadStatus;
    error: string;
  }

  const soundkeep = useSoundkeep();

  let queue = $state<UploadQueueItem[]>([]);
  let name = $state('');
  let category = $state('Imported');
  let role = $state<AssetRole>('ambience');
  let subtitle = $state('');
  let mood = $state('');
  let icon = $state<AssetIcon>('audio-lines');
  let uploading = $state(false);
  let dragActive = $state(false);

  let completed = $derived(
    queue.filter((item) => item.status === 'success' || item.status === 'error').length
  );
  let pending = $derived(
    queue.filter((item) => item.status === 'queued' || item.status === 'error').length
  );
  let progress = $derived(queue.length === 0 ? 0 : Math.round((completed / queue.length) * 100));

  function humanizeFilename(filename: string) {
    const withoutExtension = filename.replace(/\.mp3$/i, '');
    const spaced = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!spaced) return 'Untitled sound';
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function iconLabel(value: AssetIcon) {
    return value
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

  function addFiles(files: File[]) {
    if (uploading) return;
    const mp3Files = files.filter((file) => file.name.toLowerCase().endsWith('.mp3'));
    if (mp3Files.length !== files.length) {
      soundkeep.showError(new Error('Only .mp3 files can be added to Soundkeep.'));
    }
    if (mp3Files.length === 0) return;

    const existing = new Set(
      queue.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`)
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

    queue.push(...additions);
    name = queue.length === 1 ? queue[0].suggestedName : '';

    const input = document.querySelector<HTMLInputElement>('#audio-upload');
    if (input) input.value = '';
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  function removeQueued(id: string) {
    if (uploading) return;
    queue = queue.filter((item) => item.id !== id);
    name = queue.length === 1 ? queue[0].suggestedName : '';
  }

  function clearFinished() {
    if (uploading) return;
    queue = queue.filter((item) => item.status !== 'success' && item.status !== 'error');
    name = queue.length === 1 ? queue[0].suggestedName : '';
  }

  async function upload() {
    const uploadable = queue.filter((item) => item.status === 'queued' || item.status === 'error');
    if (uploadable.length === 0) {
      soundkeep.showError(new Error('Choose one or more MP3 files first.'));
      return;
    }

    uploading = true;
    const single = queue.length === 1;
    for (const item of uploadable) {
      item.status = 'uploading';
      item.error = '';
      const displayName = single && name.trim() ? name.trim() : item.suggestedName;
      const done = await soundkeep.uploadAsset(
        item.file,
        {
          name: displayName,
          category: category.trim(),
          role,
          subtitle: subtitle.trim(),
          mood: mood.trim(),
          icon
        },
        displayName,
        single
      );
      item.status = done ? 'success' : 'error';
      item.error = done ? '' : 'Upload failed. You can retry this file.';
    }
    uploading = false;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="text-base">Add MP3s</Card.Title>
    <Card.Description class="text-micro">
      Drop a batch here or choose files. Uploads are processed one at a time.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void upload();
      }}
    >
      <Field.Group class="gap-3">
        <Field.Field>
          <Field.Label for="audio-upload">MP3 files</Field.Label>
          <div
            role="region"
            aria-label="MP3 upload drop zone"
            class={cn(
              'bg-muted/30 flex flex-col items-center gap-2 rounded-lg border border-dashed p-3 text-center transition-colors',
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
            <p class="flex items-center gap-2 text-xs font-medium">
              <Upload class="size-4" />
              Drop MP3 files here
            </p>
            <Input
              id="audio-upload"
              type="file"
              accept=".mp3,audio/mpeg"
              multiple
              disabled={uploading}
              onchange={(event) =>
                addFiles(Array.from((event.currentTarget as HTMLInputElement).files ?? []))}
            />
          </div>
          <Field.Description class="text-micro">
            Only MP3 audio is accepted. Short sound effects are prewarmed for fast playback.
          </Field.Description>
        </Field.Field>

        {#if queue.length > 0}
          <Field.Field>
            <div class="flex items-center justify-between gap-3">
              <Field.Label>Upload queue</Field.Label>
              {#if completed > 0 && !uploading}
                <Button type="button" variant="ghost" size="xs" onclick={clearFinished}>
                  Clear finished
                </Button>
              {/if}
            </div>
            <div class="flex items-center justify-between gap-2">
              <span class="metric-label">{completed} of {queue.length} processed</span>
              <span class="metric">{progress}%</span>
            </div>
            <Progress value={progress} aria-label="Overall upload progress" />
            <ScrollArea.Root class="h-36 rounded-md border">
              <div class="flex flex-col p-1.5">
                {#each queue as item (item.id)}
                  <div class="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1">
                    <span class="text-muted-foreground shrink-0">
                      {#if item.status === 'uploading'}
                        <LoaderCircle class="size-3.5 animate-spin" />
                      {:else if item.status === 'success'}
                        <CheckCircle2 class="size-3.5" />
                      {:else if item.status === 'error'}
                        <CircleAlert class="size-3.5" />
                      {:else}
                        <CircleDashed class="size-3.5" />
                      {/if}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs font-medium">{item.suggestedName}</span>
                      <span class="metric-label block truncate">
                        {item.error ||
                          `${formatBytes(item.file.size)} · ${statusLabel(item.status)}`}
                      </span>
                    </span>
                    <Badge variant={item.status === 'error' ? 'warning' : 'outline'}>
                      {statusLabel(item.status)}
                    </Badge>
                    {#if item.status !== 'uploading'}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${item.file.name} from upload queue`}
                        disabled={uploading}
                        onclick={() => removeQueued(item.id)}
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

        <Field.Field data-disabled={queue.length !== 1}>
          <Field.Label for="upload-name">Display name</Field.Label>
          <Input
            id="upload-name"
            class="h-8"
            placeholder={queue.length > 1 ? 'Each file uses its filename' : 'e.g. Distant thunder'}
            disabled={queue.length !== 1 || uploading}
            bind:value={name}
          />
          <Field.Description class="text-micro">
            {queue.length > 1
              ? 'Batch uploads receive readable names from their filenames.'
              : 'The MP3 filename is converted into a readable default.'}
          </Field.Description>
        </Field.Field>

        <div class="grid gap-3 sm:grid-cols-2">
          <Field.Field>
            <Field.Label for="upload-category">Category</Field.Label>
            <Input
              id="upload-category"
              class="h-8"
              placeholder="e.g. Weather"
              disabled={uploading}
              bind:value={category}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="upload-role">Placement</Field.Label>
            <Select.Root type="single" disabled={uploading} bind:value={role}>
              <Select.Trigger id="upload-role" class="h-8 w-full">
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
          <Field.Field>
            <Field.Label for="upload-mood">Mood</Field.Label>
            <Input
              id="upload-mood"
              class="h-8"
              placeholder="e.g. Ominous"
              disabled={uploading}
              bind:value={mood}
            />
          </Field.Field>
          <Field.Field>
            <Field.Label for="upload-icon">Icon</Field.Label>
            <Select.Root type="single" disabled={uploading} bind:value={icon}>
              <Select.Trigger id="upload-icon" class="h-8 w-full">
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
        </div>

        <Field.Field>
          <Field.Label for="upload-subtitle">Subtitle</Field.Label>
          <Input
            id="upload-subtitle"
            class="h-8"
            placeholder="Optional short description"
            disabled={uploading}
            bind:value={subtitle}
          />
        </Field.Field>

        <Button type="submit" disabled={pending === 0 || uploading || soundkeep.busy !== null}>
          {#if uploading}
            <Spinner data-icon="inline-start" />
            Uploading {Math.min(completed + 1, queue.length)} of {queue.length}
          {:else}
            <Upload data-icon="inline-start" />
            {queue.length === 0
              ? 'Add MP3s'
              : queue.length === 1
                ? 'Add MP3'
                : `Add ${pending} MP3s`}
          {/if}
        </Button>
      </Field.Group>
    </form>
  </Card.Content>
</Card.Root>
