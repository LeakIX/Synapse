<!--
  Input. A single line text field with a visible label.

  Props:
  - value: string, bindable, required. The parent binds to it.
  - label: string, required. It stays visible for a screen reader even when
    `hideLabel` is true.
  - hideLabel: boolean, optional. Default false. Hides the label visually.
  - class: string, optional. Layout only, such as width.
  Every other input attribute forwards, so `placeholder` and `type` work.

  Usage:
    <Input label="Filter" hideLabel bind:value={search} placeholder="Title" />
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    value = $bindable(''),
    label,
    hideLabel = false,
    class: className = '',
    ...rest
  }: HTMLInputAttributes & {
    value?: string;
    label: string;
    hideLabel?: boolean;
  } = $props();

  const id = $props.id();
</script>

<div class={cn('flex flex-col gap-1', className)}>
  <label
    for={id}
    class={hideLabel ? 'sr-only' : 'text-xs text-muted'}
  >
    {label}
  </label>
  <input
    {id}
    bind:value
    class="rounded-md border border-border bg-bg-deep px-2 py-1 text-xs
           text-text placeholder:text-muted focus-visible:border-primary
           focus-visible:outline-none focus-visible:ring-2
           focus-visible:ring-focus"
    {...rest}
  />
</div>
