/**
 * The shapes the viewer server sends. `/api/export` returns Issue[] and
 * `/api/queue` returns QueueTask[]. Both use snake_case, because they come
 * straight from `bd list --json` and from the file queue.
 */

export type IssueStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'closed'
  | 'cancelled';

export type IssueType = 'task' | 'bug' | 'feature' | 'epic' | 'chore';

export type QueueState = 'pending' | 'active' | 'done' | 'failed';

/** One dependency edge as beads reports it. */
export interface IssueDependency {
  issue_id?: string;
  /** The issue this one waits for. Older payloads name it `blocker`. */
  depends_on_id?: string;
  blocker?: string;
  type?: string;
}

export interface Issue {
  id: string;
  title: string;
  description?: string;
  status: IssueStatus;
  priority: number;
  issue_type: IssueType;
  owner?: string;
  created_at?: string;
  /** `pr:<number>` marks an issue that tracks a pull request. */
  external_ref?: string;
  labels?: string[];
  dependencies?: IssueDependency[];
  parent?: string;
}

export interface QueueTask {
  id: string;
  issue_id: string;
  agent: string;
  state: QueueState;
  claimed_at?: string;
  completed_at?: string;
  result?: string;
}

/** A dependency edge between two issues. */
export type EdgeKind = 'blocks' | 'parent';

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

/** A laid out node: the issue plus the point the layout gave it. */
export interface GraphNode {
  issue: Issue;
  x: number;
  y: number;
}

/** One counted row of the header summary. */
export interface Stats {
  issues: number;
  open: number;
  inProgress: number;
  blocked: number;
  closed: number;
  queued: number;
  active: number;
  done: number;
  failed: number;
  agents: number;
}
