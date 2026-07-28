<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';
  import { cn, type WithElementRef } from '$lib/utils';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...rest
  }: WithElementRef<HTMLLabelAttributes, HTMLLabelElement> & { children?: Snippet } = $props();
</script>

<label
  bind:this={ref}
  data-slot="label"
  class={cn('text-muted-foreground text-xs font-semibold tracking-wide', className)}
  {...rest}
>
  {@render children?.()}
</label>
