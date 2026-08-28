<!--
  IssueSheet. Every fact the viewer holds about one issue.

  Props:
  - open: boolean, bindable, required.
  - issue: Issue | null, required. The sheet renders nothing when it is
    null.
  - task: QueueTask | undefined, required. The queue task for the issue.
  - dependencies: string[], required. The issues this one waits for.
  - dependents: string[], required. The issues that wait for this one.
  - onnavigate: (id: string) => void, required. The sheet calls it when the
    reader follows a link to another issue.
-->
<script lang="ts">
  import { agentIcon, issueAgent } from '$lib/agents';
  import Badge from '$lib/components/ui/Badge.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Field from '$lib/components/ui/Field.svelte';
  import Sheet from '$lib/components/ui/Sheet.svelte';
  import type { BadgeTone } from '$lib/components/ui/badge';
  import type { Issue, QueueState, QueueTask } from '$lib/types';

  let {
    open = $bindable(false),
    issue,
    task,
    dependencies,
    dependents,
    onnavigate,
  }: {
    open?: boolean;
    issue: Issue | null;
    task: QueueTask | undefined;
    dependencies: string[];
    dependents: string[];
    onnavigate: (id: string) => void;
  } = $props();

  const STATE_TONE: Record<QueueState, BadgeTone> = {
    pending: 'warning',
    active: 'info',
    done: 'success',
    failed: 'danger',
  };

  let agent = $derived(issue ? (task?.agent ?? issueAgent(issue)) : null);
</script>

{#if issue}
  <Sheet bind:open title={issue.title} description={issue.id}>
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <Badge tone={issue.issue_type === 'epic' ? 'info' : 'neutral'}>
        {issue.issue_type}
      </Badge>
      <Badge tone={issue.status === 'blocked' ? 'danger' : 'neutral'}>
        {issue.status}
      </Badge>
      <Badge>P{issue.priority}</Badge>
    </div>

    {#if agent}
      {@const Icon = agentIcon(agent)}
      <Field label="Agent">
        <span class="flex items-center gap-1.5">
          <Icon class="size-3.5" aria-hidden="true" />
          <strong>{agent}</strong>
        </span>
      </Field>
    {/if}

    <Field label="Description">
      {#if issue.description}
        <span class="whitespace-pre-wrap">{issue.description}</span>
      {:else}
        <span class="text-muted">The issue has no description.</span>
      {/if}
    </Field>

    {#if task}
      <div class="mt-3 border-t border-border pt-3">
        <p class="mb-2 text-xs font-semibold text-text">Queue</p>
        <Field label="State">
          <Badge tone={STATE_TONE[task.state]}>{task.state}</Badge>
        </Field>
        <Field label="Task" mono>{task.id}</Field>
        {#if task.claimed_at}
          <Field label="Claimed">{task.claimed_at}</Field>
        {/if}
        {#if task.completed_at}
          <Field label="Completed">{task.completed_at}</Field>
        {/if}
        {#if task.result}
          <Field label="Result">
            <span class="whitespace-pre-wrap">{task.result}</span>
          </Field>
        {/if}
      </div>
    {/if}

    <div class="mt-3 border-t border-border pt-3">
      <p class="mb-2 text-xs font-semibold text-text">
        Waits for ({dependencies.length})
      </p>
      {#each dependencies as id (id)}
        <div class="flex items-center justify-between gap-2 py-1">
          <span class="truncate text-xs text-muted">{id}</span>
          <Button size="sm" onclick={() => onnavigate(id)}>Open</Button>
        </div>
      {:else}
        <p class="text-xs text-muted">Nothing blocks this issue.</p>
      {/each}
    </div>

    <div class="mt-3 border-t border-border pt-3">
      <p class="mb-2 text-xs font-semibold text-text">
        Blocks ({dependents.length})
      </p>
      {#each dependents as id (id)}
        <div class="flex items-center justify-between gap-2 py-1">
          <span class="truncate text-xs text-muted">{id}</span>
          <Button size="sm" onclick={() => onnavigate(id)}>Open</Button>
        </div>
      {:else}
        <p class="text-xs text-muted">This issue blocks nothing.</p>
      {/each}
    </div>
  </Sheet>
{/if}
