<!--
  StatsBar. One line of counts for the whole board.

  Props:
  - stats: Stats, required. The counts the page computes.

  Usage:
    <StatsBar {stats} />
-->
<script lang="ts">
  import type { Stats } from '$lib/types';

  let { stats }: { stats: Stats } = $props();

  let rows = $derived([
    { label: 'issues', value: stats.issues },
    { label: 'open', value: stats.open },
    { label: 'in progress', value: stats.inProgress },
    { label: 'blocked', value: stats.blocked },
    { label: 'closed', value: stats.closed },
    { label: 'queued', value: stats.queued },
    { label: 'active', value: stats.active },
    { label: 'done', value: stats.done },
    { label: 'failed', value: stats.failed },
    { label: 'agents', value: stats.agents },
  ]);
</script>

<dl class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
  {#each rows as row (row.label)}
    <div class="flex items-center gap-1">
      <dt class="sr-only">{row.label}</dt>
      <dd class="font-semibold text-text">{row.value}</dd>
      <span aria-hidden="true">{row.label}</span>
    </div>
  {/each}
</dl>
