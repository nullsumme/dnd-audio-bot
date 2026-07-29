<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    label,
    value,
    class: className,
    children
  }: {
    label: string;
    value?: string | number;
    class?: string;
    children?: Snippet;
  } = $props();
</script>

<div
  class={cn(
    'border-border/40 flex min-h-(--row-h) items-center justify-between gap-3 border-b py-1 last:border-b-0',
    className
  )}
>
  <span class="metric-label truncate">{label}</span>
  <span class="metric min-w-0 truncate text-right">
    {#if children}{@render children()}{:else}{value}{/if}
  </span>
</div>
