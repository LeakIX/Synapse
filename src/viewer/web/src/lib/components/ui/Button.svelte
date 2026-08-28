<!--
  Button.

  Props (all optional except children):
  - variant: 'primary' | 'secondary' | 'ghost'. Default 'secondary'.
  - size: 'sm' | 'md'. Default 'md'.
  - block: boolean. Default false. Adds full width.
  - class: string. Layout only, such as margin or grid placement. Never
    colour, padding, radius or type. A new look is a new variant.
  - children: Snippet, required.
  Every other button attribute forwards, so `onclick`, `disabled` and
  `aria-*` work as on a plain button.

  Usage:
    <Button variant="primary" size="sm" onclick={refresh}>Refresh</Button>
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils';
  import { buttonVariants, type ButtonSize, type ButtonVariant } from './button';

  let {
    variant,
    size,
    block,
    class: className = '',
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class={cn(buttonVariants({ variant, size, block }), className)}
  {...rest}
>
  {@render children()}
</button>
