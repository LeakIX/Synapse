<!--
  Sheet. A panel that slides in from the right edge.

  It wraps the bits-ui dialog, so the focus trap, the Escape key, the
  outside click and the ARIA roles come from a tested source. This file
  adds the LeakIX styling only.

  Props:
  - open: boolean, bindable, required. The parent binds to it.
  - title: string, required. The heading, also the accessible name.
  - description: string, optional. One line under the heading.
  - children: Snippet, required. The panel body.

  Usage:
    <Sheet bind:open title={issue.title} description={issue.id}>
      ...
    </Sheet>
-->
<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    description,
    children,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-bg-deep/60" />
    <Dialog.Content
      class="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col
             border-l border-border bg-card shadow-lg outline-none"
    >
      <div class="flex items-start gap-2 border-b border-border p-4">
        <div class="min-w-0 flex-1">
          <Dialog.Title class="text-sm font-semibold break-words text-text">
            {title}
          </Dialog.Title>
          {#if description}
            <Dialog.Description class="mt-1 text-xs break-all text-muted">
              {description}
            </Dialog.Description>
          {/if}
        </div>
        <Dialog.Close
          aria-label="Close the panel"
          class="cursor-pointer rounded-md p-1 text-muted transition-colors
                 hover:text-text focus-visible:ring-2 focus-visible:ring-focus
                 focus-visible:outline-none"
        >
          <X class="size-4" aria-hidden="true" />
        </Dialog.Close>
      </div>
      <div class="flex-1 overflow-y-auto p-4">
        {@render children()}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
