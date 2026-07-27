<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className,
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    ...rest
  }: Omit<HTMLInputAttributes, 'value' | 'type'> & {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
  } = $props();
</script>

<input
  data-slot="slider"
  class={cn('soundkeep-slider h-5 w-full cursor-pointer appearance-none bg-transparent', className)}
  type="range"
  bind:value
  {min}
  {max}
  {step}
  {...rest}
/>
