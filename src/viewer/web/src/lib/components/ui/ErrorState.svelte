<!--
  ErrorState. The failure branch of a data region.

  Props:
  - title: string, optional. Default 'The viewer cannot read the data'.
  - message: string, required. The plain reason, such as the status code.
  - action: Snippet, optional. One recovery button, such as a retry.

  Usage:
    <ErrorState message={error} >
      {#snippet action()}<Button onclick={reload}>Retry</Button>{/snippet}
    </ErrorState>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let {
    title = 'The viewer cannot read the data',
    message,
    action,
  }: { title?: string; message: string; action?: Snippet } = $props();
</script>

<div role="alert" class="flex flex-col items-center gap-2 p-8 text-center">
  <TriangleAlert class="size-8 text-danger" aria-hidden="true" />
  <p class="text-sm font-semibold text-text">{title}</p>
  <p class="max-w-prose text-xs text-muted">{message}</p>
  {#if action}
    {@render action()}
  {/if}
</div>
