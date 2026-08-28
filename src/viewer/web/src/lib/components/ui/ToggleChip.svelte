<!--
  ToggleChip. A small on or off filter control.

  Props:
  - pressed: boolean, required. The parent owns the state and passes it back.
  - class: string, optional. Layout only.
  - children: Snippet, required.
  Every other button attribute forwards, so `onclick` works as usual.

  The component sets aria-pressed, so a screen reader reports the state.

  Usage:
    <ToggleChip pressed={status === 'open'} onclick={() => select('open')}>
      Open
    </ToggleChip>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';

  let {
    pressed,
    class: className = '',
    children,
    ...rest
  }: HTMLButtonAttributes & { pressed: boolean; children: Snippet } = $props();

  const base =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border ' +
    'px-2.5 py-1 text-xs transition-colors focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-bg';
  let state = $derived(
    pressed
      ? 'border-primary bg-primary text-on-primary'
      : 'border-border bg-transparent text-muted hover:border-primary hover:text-text',
  );
</script>

<button type="button" aria-pressed={pressed} class={cn(base, state, className)} {...rest}>
  {@render children()}
</button>
