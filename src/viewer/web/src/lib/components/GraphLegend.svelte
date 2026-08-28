<!--
  GraphLegend. It reads the colours of the graph.

  Props:
  - agents: string[], required. The agents the data mentions. The legend
    lists each one with its colour and its icon.

  The legend also names the four issue colours and the two node shapes, so
  a reader can decode a node without a click.
-->
<script lang="ts">
  import { agentDot, agentIcon } from '$lib/agents';
  import Card from '$lib/components/ui/Card.svelte';

  let { agents }: { agents: string[] } = $props();

  const STATES = [
    { label: 'Epic', dot: 'bg-node-epic' },
    { label: 'Open', dot: 'bg-node-open' },
    { label: 'In progress', dot: 'bg-node-progress' },
    { label: 'Blocked', dot: 'bg-node-blocked' },
    { label: 'Closed', dot: 'bg-node-closed' },
  ];
</script>

<Card class="absolute bottom-3 left-3 max-w-56">
  <p class="mb-2 text-xs font-semibold text-text">Legend</p>
  {#each agents as agent (agent)}
    {@const Icon = agentIcon(agent)}
    <div class="my-1 flex items-center gap-2">
      <span class={`size-2.5 shrink-0 rounded-full ${agentDot(agent)}`}></span>
      <Icon class="size-3 shrink-0 text-muted" aria-hidden="true" />
      <span class="truncate text-xs text-muted">{agent}</span>
    </div>
  {/each}
  {#each STATES as state (state.label)}
    <div class="my-1 flex items-center gap-2">
      <span class={`size-2.5 shrink-0 rounded-full ${state.dot}`}></span>
      <span class="text-xs text-muted">{state.label}</span>
    </div>
  {/each}
  <div class="my-1 flex items-center gap-2">
    <span class="size-2.5 shrink-0 rounded-xs bg-node-pr"></span>
    <span class="text-xs text-muted">Pull request</span>
  </div>
  <div class="my-1 flex items-center gap-2">
    <span class="size-2.5 shrink-0 rotate-45 bg-primary"></span>
    <span class="text-xs text-muted">Active task</span>
  </div>
</Card>
