<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  type Variant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  type Size = 'default' | 'sm' | 'lg' | 'icon';

  let {
    class: className,
    variant = 'default',
    size = 'default',
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: Variant;
    size?: Size;
    children?: Snippet;
  } = $props();

  const variants: Record<Variant, string> = {
    default:
      'bg-primary text-primary-foreground shadow-[0_8px_28px_-10px_color-mix(in_oklab,var(--primary)_65%,transparent)] hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline:
      'border border-border/90 bg-background/30 text-foreground hover:border-primary/45 hover:bg-accent',
    ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
    destructive: 'bg-destructive text-white hover:bg-destructive/90'
  };
  const sizes: Record<Size, string> = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 rounded-md px-3 text-xs',
    lg: 'h-12 rounded-xl px-6 text-base',
    icon: 'size-9'
  };
</script>

<button
  data-slot="button"
  class={cn(
    'focus-visible:ring-ring/60 inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-45',
    variants[variant],
    sizes[size],
    className
  )}
  {...rest}
>
  {@render children?.()}
</button>
