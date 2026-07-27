<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & { children?: Snippet } = $props();
</script>

<h3 data-slot="card-title" class={cn('font-display text-lg font-semibold', className)} {...rest}>
  {@render children?.()}
</h3>
