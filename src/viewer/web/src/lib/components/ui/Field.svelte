<!--
  Field. One labelled read only value in a detail panel.

  Props:
  - label: string, required.
  - mono: boolean, optional. Default false. Use it for an identifier.
  - children: Snippet, required. The value.

  Usage:
    <Field label="Task" mono>{task.id}</Field>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';

  let {
    label,
    mono = false,
    children,
  }: { label: string; mono?: boolean; children: Snippet } = $props();
</script>

<div class="mb-3">
  <p class="mb-1 text-xs text-muted">{label}</p>
  <div class={cn('text-xs text-text', mono && 'break-all')}>
    {@render children()}
  </div>
</div>
