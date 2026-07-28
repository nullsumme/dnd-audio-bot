<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';

  let {
    class: className,
    ref = $bindable(null),
    value = $bindable(),
    type = 'text',
    ...rest
  }: WithElementRef<HTMLInputAttributes, HTMLInputElement> = $props();
</script>

{#if type === 'file'}
  <input
    bind:this={ref}
    data-slot="input"
    class={cn(
      'border-input bg-background/55 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-ring/20 h-10 w-full rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {type}
    {...rest}
  />
{:else}
  <input
    bind:this={ref}
    data-slot="input"
    class={cn(
      'border-input bg-background/55 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-ring/20 h-10 w-full rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    bind:value
    {type}
    {...rest}
  />
{/if}
