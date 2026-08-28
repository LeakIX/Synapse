<!--
  Badge.

  Props:
  - tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning'.
    Default 'neutral'.
  - class: string, optional. Layout only.
  - children: Snippet, required.

  Usage:
    <Badge tone="danger">failed</Badge>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { badgeVariants, type BadgeTone } from './badge';

  let {
    tone,
    class: className = '',
    children,
    ...rest
  }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; children: Snippet } =
    $props();
</script>

<span class={cn(badgeVariants({ tone }), className)} {...rest}>
  {@render children()}
</span>
