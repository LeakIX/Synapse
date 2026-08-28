<!--
  Card. A raised surface on the navy background.

  Props:
  - class: string, optional. Layout only, such as position or width.
  - children: Snippet, required.

  Usage:
    <Card class="absolute bottom-3 left-3">...</Card>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    class: className = '',
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & { children: Snippet } = $props();
</script>

<div
  class={cn('rounded-md border border-border bg-card p-3', className)}
  {...rest}
>
  {@render children()}
</div>
