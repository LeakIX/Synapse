import { agentFill, issueAgent } from './agents';
import type {
  GraphEdge,
  Issue,
  QueueTask,
  Stats,
} from './types';

/** Index the queue by issue, because a node asks for its own task. */
export function tasksByIssue(tasks: QueueTask[]): Map<string, QueueTask> {
  const index = new Map<string, QueueTask>();
  for (const task of tasks) {
    if (!index.has(task.issue_id)) {
      index.set(task.issue_id, task);
    }
  }
  return index;
}

/** An issue whose external reference starts with `pr:` tracks a pull request. */
export function isPullRequest(issue: Issue): boolean {
  return (issue.external_ref ?? '').startsWith('pr:');
}

export function pullRequestNumber(issue: Issue): string | null {
  return isPullRequest(issue)
    ? (issue.external_ref as string).slice('pr:'.length)
    : null;
}

/**
 * Build the edge list. A dependency points from the issue to the issue it
 * waits for. A parent points from the epic down to the child. Duplicate
 * pairs collapse to one edge.
 */
export function buildEdges(issues: Issue[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string, kind: GraphEdge['kind']) => {
    const key = `${from}>${to}>${kind}`;
    if (from === to || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind });
  };
  for (const issue of issues) {
    for (const dep of issue.dependencies ?? []) {
      const target = dep.depends_on_id ?? dep.blocker;
      if (target) add(issue.id, target, 'blocks');
    }
    if (issue.parent) add(issue.parent, issue.id, 'parent');
  }
  return edges;
}

export type NodeShape = 'circle' | 'square' | 'diamond';

/** An active task shows as a diamond. A pull request shows as a square. */
export function nodeShape(issue: Issue, task?: QueueTask): NodeShape {
  if (task?.state === 'active') return 'diamond';
  if (isPullRequest(issue)) return 'square';
  return 'circle';
}

export function nodeRadius(issue: Issue, task?: QueueTask): number {
  if (issue.issue_type === 'epic') return 24;
  if (task) return 18;
  return isPullRequest(issue) ? 14 : 16;
}

/**
 * The fill utility for a node. The queue wins over the issue, because a
 * running task is the freshest fact about the issue.
 */
export function nodeFill(issue: Issue, task?: QueueTask): string {
  if (task) {
    if (task.state === 'failed') return 'fill-node-failed';
    if (task.state === 'done') return 'fill-node-done';
    return agentFill(task.agent);
  }
  if (issue.status === 'closed' || issue.status === 'cancelled') {
    return isPullRequest(issue) ? 'fill-node-done' : 'fill-node-closed';
  }
  if (isPullRequest(issue)) return 'fill-node-pr';
  if (issue.issue_type === 'epic') return 'fill-node-epic';
  const agent = issueAgent(issue);
  if (agent) return agentFill(agent);
  if (issue.status === 'in_progress') return 'fill-node-progress';
  if (issue.status === 'blocked') return 'fill-node-blocked';
  return 'fill-node-open';
}

export type StatusFilter =
  | 'all'
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'closed'
  | 'epic'
  | 'queued'
  | 'active';

export interface Filters {
  status: StatusFilter;
  search: string;
  agents: string[];
}

function matchesStatus(
  issue: Issue,
  task: QueueTask | undefined,
  status: StatusFilter,
): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'epic':
      return issue.issue_type === 'epic';
    case 'queued':
      return task?.state === 'pending';
    case 'active':
      return task?.state === 'active';
    default:
      return issue.status === status;
  }
}

function matchesSearch(issue: Issue, term: string): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  const agent = issueAgent(issue) ?? '';
  return [issue.title, issue.id, issue.external_ref ?? '', agent].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

function matchesAgent(
  issue: Issue,
  task: QueueTask | undefined,
  agents: string[],
): boolean {
  if (agents.length === 0) return true;
  const owner = issueAgent(issue);
  if (owner && agents.includes(owner)) return true;
  return task !== undefined && agents.includes(task.agent);
}

/** Apply every filter. An issue must pass all three to stay visible. */
export function filterIssues(
  issues: Issue[],
  tasks: Map<string, QueueTask>,
  filters: Filters,
): Issue[] {
  return issues.filter((issue) => {
    const task = tasks.get(issue.id);
    return (
      matchesStatus(issue, task, filters.status) &&
      matchesSearch(issue, filters.search) &&
      matchesAgent(issue, task, filters.agents)
    );
  });
}

/** Every agent the data mentions, either on an issue or on a task. */
export function knownAgentNames(issues: Issue[], tasks: QueueTask[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const agent = issueAgent(issue);
    if (agent) names.add(agent);
  }
  for (const task of tasks) {
    if (task.agent) names.add(task.agent);
  }
  return [...names].sort();
}

/** Count the header summary in one pass over each list. */
export function computeStats(issues: Issue[], tasks: QueueTask[]): Stats {
  const countIssues = (match: (issue: Issue) => boolean) =>
    issues.filter(match).length;
  const countTasks = (state: QueueTask['state']) =>
    tasks.filter((task) => task.state === state).length;
  return {
    issues: issues.length,
    open: countIssues((i) => i.status === 'open'),
    inProgress: countIssues((i) => i.status === 'in_progress'),
    blocked: countIssues((i) => i.status === 'blocked'),
    closed: countIssues((i) => i.status === 'closed' || i.status === 'cancelled'),
    queued: countTasks('pending'),
    active: countTasks('active'),
    done: countTasks('done'),
    failed: countTasks('failed'),
    agents: knownAgentNames(issues, tasks).length,
  };
}
