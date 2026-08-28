<!--
  Skeleton. A pulsing placeholder for content of a known shape.

  Props:
  - class: string, required in practice. It sets the size of the
    placeholder, such as `h-4 w-32`. Size is layout, so a class is correct
    here.

  Usage:
    <Skeleton class="h-4 w-40" />
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className = '',
    ...rest
  }: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
  aria-hidden="true"
  class={cn('animate-pulse rounded bg-border', className)}
  {...rest}
></div>
