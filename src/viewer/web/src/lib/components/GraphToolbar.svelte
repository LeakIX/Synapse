<!--
  GraphToolbar. The status filter, the agent filter and the title search.

  Props:
  - status: StatusFilter, bindable, required.
  - search: string, bindable, required.
  - selectedAgents: string[], bindable, required. An empty list means every
    agent.
  - agents: string[], required. The agents the data mentions.

  Usage:
    <GraphToolbar bind:status bind:search bind:selectedAgents {agents} />
-->
<script lang="ts">
  import { agentDot, agentIcon } from '$lib/agents';
  import Input from '$lib/components/ui/Input.svelte';
  import ToggleChip from '$lib/components/ui/ToggleChip.svelte';
  import type { StatusFilter } from '$lib/graph';

  let {
    status = $bindable('all'),
    search = $bindable(''),
    selectedAgents = $bindable([]),
    agents,
  }: {
    status: StatusFilter;
    search: string;
    selectedAgents: string[];
    agents: string[];
  } = $props();

  const STATUSES: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'closed', label: 'Closed' },
    { value: 'epic', label: 'Epics' },
    { value: 'queued', label: 'Queued' },
    { value: 'active', label: 'Active' },
  ];

  function toggleAgent(name: string) {
    selectedAgents = selectedAgents.includes(name)
      ? selectedAgents.filter((entry) => entry !== name)
      : [...selectedAgents, name];
  }
</script>

<div
  class="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2"
>
  {#each STATUSES as option (option.value)}
    <ToggleChip
      pressed={status === option.value}
      onclick={() => (status = option.value)}
    >
      {option.label}
    </ToggleChip>
  {/each}

  {#if agents.length > 0}
    <span class="h-5 w-px bg-border" aria-hidden="true"></span>
    {#each agents as agent (agent)}
      {@const Icon = agentIcon(agent)}
      <ToggleChip
        pressed={selectedAgents.includes(agent)}
        onclick={() => toggleAgent(agent)}
      >
        <span class={`size-2 rounded-full ${agentDot(agent)}`}></span>
        <Icon class="size-3" aria-hidden="true" />
        {agent}
      </ToggleChip>
    {/each}
  {/if}

  <Input
    label="Filter by title"
    hideLabel
    bind:value={search}
    placeholder="Filter by title"
    class="ml-auto w-44"
  />
</div>
