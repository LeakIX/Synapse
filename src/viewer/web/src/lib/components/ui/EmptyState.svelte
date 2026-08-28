<!--
  EmptyState. The zero row branch of a data region.

  Props:
  - title: string, required. What is missing.
  - description: string, optional. What the reader can do next.
  - action: Snippet, optional. One button, such as a filter reset.

  Usage:
    <EmptyState title="No issue matches" description="Clear the filters." />
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Inbox from '@lucide/svelte/icons/inbox';

  let {
    title,
    description,
    action,
  }: { title: string; description?: string; action?: Snippet } = $props();
</script>

<div class="flex flex-col items-center gap-2 p-8 text-center">
  <Inbox class="size-8 text-muted" aria-hidden="true" />
  <p class="text-sm font-semibold text-text">{title}</p>
  {#if description}
    <p class="max-w-prose text-xs text-muted">{description}</p>
  {/if}
  {#if action}
    {@render action()}
  {/if}
</div>
