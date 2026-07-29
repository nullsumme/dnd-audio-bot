<script lang="ts">
  import {
    AudioLines,
    Bell,
    CloudLightning,
    DoorOpen,
    Flame,
    Music2,
    Skull,
    Sparkles,
    Swords,
    Waves,
    Wind,
    Zap
  } from '@lucide/svelte';
  import type { AssetIcon } from '$lib/asset-metadata';

  let { icon, class: className }: { icon: AssetIcon; class?: string } = $props();

  const glyphs = {
    'audio-lines': AudioLines,
    bell: Bell,
    'cloud-lightning': CloudLightning,
    'door-open': DoorOpen,
    flame: Flame,
    music: Music2,
    skull: Skull,
    sparkles: Sparkles,
    swords: Swords,
    waves: Waves,
    wind: Wind,
    zap: Zap
  } satisfies Record<AssetIcon, typeof AudioLines>;

  let Glyph = $derived(glyphs[icon] ?? AudioLines);
</script>

<Glyph class={className} />
