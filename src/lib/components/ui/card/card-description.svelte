<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  let {
    class: className,
    children,
    ...rest
  }: HTMLAttributes<HTMLParagraphElement> & { children?: Snippet } = $props();
</script>

<p data-slot="card-description" class={cn('text-muted-foreground text-sm', className)} {...rest}>
  {@render children?.()}
</p>
