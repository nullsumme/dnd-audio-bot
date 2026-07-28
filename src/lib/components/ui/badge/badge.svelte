<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    variant = 'default',
    children,
    ...rest
  }: HTMLAttributes<HTMLSpanElement> & {
    variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning';
    children?: Snippet;
  } = $props();

  const variants = {
    default: 'border-transparent bg-primary/15 text-primary',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    outline: 'border-border text-muted-foreground',
    success: 'border-transparent bg-primary/15 text-primary',
    warning: 'border-transparent bg-secondary text-secondary-foreground'
  };
</script>

<span
  data-slot="badge"
  class={cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
    variants[variant],
    className
  )}
  {...rest}
>
  {@render children?.()}
</span>
