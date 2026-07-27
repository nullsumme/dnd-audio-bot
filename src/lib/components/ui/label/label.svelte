<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLLabelAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    children,
    ...rest
  }: HTMLLabelAttributes & { children?: Snippet } = $props();
</script>

<label
  data-slot="label"
  class={cn('text-muted-foreground text-xs font-semibold tracking-wide', className)}
  {...rest}
>
  {@render children?.()}
</label>
