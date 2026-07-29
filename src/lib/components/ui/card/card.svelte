<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { children?: Snippet } = $props();
</script>

<div
  data-slot="card"
  class={cn(
    'border-border/70 bg-card/88 text-card-foreground rounded-xl border shadow-[0_20px_55px_-38px_rgba(0,0,0,0.9)] backdrop-blur',
    className
  )}
  {...rest}
>
  {@render children?.()}
</div>
