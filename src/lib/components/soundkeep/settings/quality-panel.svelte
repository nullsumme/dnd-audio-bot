<script lang="ts">
  import { Gauge } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import * as Field from '$lib/components/ui/field';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import StatRow from '$lib/components/soundkeep/stat-row.svelte';
  import { isDiscordBitrateMode, type DiscordBitrateMode } from '$lib/audio-quality';
  import { useSoundkeep } from '$lib/soundkeep-client.svelte';

  const soundkeep = useSoundkeep();

  let mode = $state<DiscordBitrateMode>(soundkeep.state.discord.audioDiagnostics.bitrateMode);
  let dirty = $state(false);

  $effect(() => {
    if (!dirty && soundkeep.busy !== 'discord-bitrate') {
      mode = soundkeep.state.discord.audioDiagnostics.bitrateMode;
    }
  });

  function select(value: string) {
    if (!isDiscordBitrateMode(value)) return;
    mode = value;
    dirty = value !== soundkeep.state.discord.audioDiagnostics.bitrateMode;
  }

  async function apply() {
    const applied = await soundkeep.changeDiscordBitrate(mode);
    dirty = false;
    if (!applied) mode = soundkeep.state.discord.audioDiagnostics.bitrateMode;
  }

  function bitrateLabel(value: number | null, fallback: string) {
    return value === null ? fallback : `${Math.round(value / 1_000)} kbps`;
  }

  function modeLabel(value: DiscordBitrateMode) {
    return value === 'auto' ? 'Auto' : `${Math.round(Number(value) / 1_000)} kbps`;
  }
</script>

<Card.Root class="min-w-0">
  <Card.Header class="pb-2">
    <Card.Title class="flex items-center gap-2 text-base">
      <Gauge class="size-4" />
      Discord audio quality
    </Card.Title>
    <Card.Description class="text-micro">
      Choose the Opus quality target used for the final stereo mix.
    </Card.Description>
  </Card.Header>
  <Card.Content>
    <Field.Group class="gap-3">
      <Field.Field>
        <Field.Label id="discord-bitrate-label">Opus bitrate</Field.Label>
        <ToggleGroup.Root
          type="single"
          variant="outline"
          spacing={1}
          value={mode}
          onValueChange={select}
          disabled={soundkeep.busy !== null}
          aria-labelledby="discord-bitrate-label"
          class="w-full flex-wrap"
        >
          <ToggleGroup.Item value="auto" class="flex-1">Auto</ToggleGroup.Item>
          <ToggleGroup.Item value="64000" class="flex-1">64 kbps</ToggleGroup.Item>
          <ToggleGroup.Item value="96000" class="flex-1">96 kbps</ToggleGroup.Item>
          <ToggleGroup.Item value="128000" class="flex-1">128 kbps</ToggleGroup.Item>
          <ToggleGroup.Item value="384000" class="flex-1">384 kbps</ToggleGroup.Item>
        </ToggleGroup.Root>
        <Field.Description class="text-micro">
          Auto uses the Discord channel limit up to 384 kbps. Fixed choices are also capped by the
          channel.
        </Field.Description>
      </Field.Field>
      <div>
        <StatRow
          label="Configured"
          value={dirty
            ? `${modeLabel(soundkeep.state.discord.audioDiagnostics.bitrateMode)} → ${modeLabel(mode)} pending`
            : modeLabel(soundkeep.state.discord.audioDiagnostics.bitrateMode)}
        />
        <StatRow
          label="Channel limit"
          value={bitrateLabel(
            soundkeep.state.discord.audioDiagnostics.channelBitrate,
            'Not connected'
          )}
        />
        <StatRow
          label="Current output"
          value={`${bitrateLabel(soundkeep.state.discord.audioDiagnostics.bitrate, 'Inactive')}${
            soundkeep.state.discord.audioDiagnostics.bitrateReconfiguring ? ' (updating)' : ''
          }`}
        />
      </div>
      <div class="flex justify-end">
        <Button size="sm" disabled={!dirty || soundkeep.busy !== null} onclick={apply}>
          {#if soundkeep.busy === 'discord-bitrate'}
            <Spinner data-icon="inline-start" />
          {/if}
          Apply bitrate
        </Button>
      </div>
    </Field.Group>
  </Card.Content>
</Card.Root>
