<!--
  Root layout.

  Props:
  - children: Snippet, required. The page to render.

  It loads the single Tailwind entry and paints the page background, so a
  page never repeats the shell chrome.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import '../app.css';

  let { children }: { children: Snippet } = $props();
</script>

<div class="flex h-screen w-full flex-col bg-bg text-text">
  {@render children()}
</div>
