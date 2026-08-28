<!--
  The viewer page.

  It reads the issue graph and the queue, lays the graph out, and holds the
  filter state. It renders one of four branches: loading, error, empty, or
  the graph.
-->
<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { onMount } from 'svelte';
  import { knownAgentNames } from '$lib/graph';
  import { fetchSnapshot } from '$lib/api';
  import {
    buildEdges,
    computeStats,
    filterIssues,
    tasksByIssue,
    type Filters,
    type StatusFilter,
  } from '$lib/graph';
  import { layoutGraph, type Point } from '$lib/layout';
  import type { GraphEdge, Issue, QueueTask } from '$lib/types';
  import Button from '$lib/components/ui/Button.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import ErrorState from '$lib/components/ui/ErrorState.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import GraphCanvas from '$lib/components/GraphCanvas.svelte';
  import GraphLegend from '$lib/components/GraphLegend.svelte';
  import GraphToolbar from '$lib/components/GraphToolbar.svelte';
  import IssueSheet from '$lib/components/IssueSheet.svelte';
  import StatsBar from '$lib/components/StatsBar.svelte';

  const REFRESH_MS = 30_000;

  let issues = $state<Issue[]>([]);
  let queue = $state<QueueTask[]>([]);
  let edges = $state<GraphEdge[]>([]);
  let positions = $state<Record<string, Point>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);

  let status = $state<StatusFilter>('all');
  let search = $state('');
  let selectedAgents = $state<string[]>([]);
  let selectedId = $state<string | null>(null);
  let sheetOpen = $state(false);

  /** The id set the current layout belongs to. */
  let laidOut = '';

  let tasks = $derived(tasksByIssue(queue));
  let agents = $derived(knownAgentNames(issues, queue));
  let stats = $derived(computeStats(issues, queue));
  let filters = $derived<Filters>({ status, search, agents: selectedAgents });
  let visible = $derived(filterIssues(issues, tasks, filters));
  let selected = $derived(issues.find((issue) => issue.id === selectedId) ?? null);
  let dependencies = $derived(
    edges.filter((e) => e.kind === 'blocks' && e.from === selectedId).map((e) => e.to),
  );
  let dependents = $derived(
    edges.filter((e) => e.kind === 'blocks' && e.to === selectedId).map((e) => e.from),
  );

  /**
   * Lay the graph out again only when the issue set changes. A refresh with
   * the same issues therefore keeps every node where the reader put it.
   */
  function relayout(nextIssues: Issue[], nextEdges: GraphEdge[]) {
    const ids = nextIssues.map((issue) => issue.id);
    const signature = [...ids].sort().join(',');
    if (signature === laidOut) return;
    laidOut = signature;
    const points = layoutGraph(ids, nextEdges);
    const record: Record<string, Point> = {};
    for (const [id, point] of points) {
      record[id] = point;
    }
    positions = record;
  }

  async function load() {
    try {
      const snapshot = await fetchSnapshot();
      const nextEdges = buildEdges(snapshot.issues);
      relayout(snapshot.issues, nextEdges);
      issues = snapshot.issues;
      queue = snapshot.tasks;
      edges = nextEdges;
      error = null;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  function open(id: string) {
    selectedId = id;
    sheetOpen = true;
  }

  function clearFilters() {
    status = 'all';
    search = '';
    selectedAgents = [];
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  });
</script>

<header
  class="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2"
>
  <h1 class="text-sm font-semibold text-text">Synapse Brain</h1>
  <div class="ml-auto flex items-center gap-3">
    {#if loading}
      <Skeleton class="h-4 w-64" />
    {:else if !error}
      <StatsBar {stats} />
    {/if}
    <Button variant="primary" size="sm" onclick={() => void load()}>
      <RefreshCw class="size-3.5" aria-hidden="true" />
      Refresh
    </Button>
  </div>
</header>

<GraphToolbar bind:status bind:search bind:selectedAgents {agents} />

<main class="relative flex-1 overflow-hidden">
  {#if loading}
    <div class="flex h-full flex-col items-center justify-center gap-3">
      <Skeleton class="size-24 rounded-full" />
      <Skeleton class="h-3 w-48" />
      <Skeleton class="h-3 w-32" />
    </div>
  {:else if error}
    <div class="flex h-full items-center justify-center">
      <ErrorState message={error}>
        {#snippet action()}
          <Button variant="primary" size="sm" onclick={() => void load()}>
            Try again
          </Button>
        {/snippet}
      </ErrorState>
    </div>
  {:else if issues.length === 0}
    <div class="flex h-full items-center justify-center">
      <EmptyState
        title="The board is empty"
        description="No issue exists yet. Create one with beads, then refresh."
      />
    </div>
  {:else if visible.length === 0}
    <div class="flex h-full items-center justify-center">
      <EmptyState
        title="No issue matches the filters"
        description="Change the status, the agent or the search text."
      >
        {#snippet action()}
          <Button size="sm" onclick={clearFilters}>Clear the filters</Button>
        {/snippet}
      </EmptyState>
    </div>
  {:else}
    <GraphCanvas
      issues={visible}
      {edges}
      {tasks}
      bind:positions
      bind:selectedId
      onopen={open}
    />
    <GraphLegend {agents} />
  {/if}
</main>

<IssueSheet
  bind:open={sheetOpen}
  issue={selected}
  task={selectedId ? tasks.get(selectedId) : undefined}
  {dependencies}
  {dependents}
  onnavigate={open}
/>
