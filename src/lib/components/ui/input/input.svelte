<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let { class: className, value = $bindable(), ...rest }: HTMLInputAttributes = $props();
</script>

<input
  data-slot="input"
  class={cn(
    'border-input bg-background/55 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-ring/20 h-10 w-full rounded-lg border px-3 py-2 text-sm transition outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
    className
  )}
  bind:value
  {...rest}
/>
