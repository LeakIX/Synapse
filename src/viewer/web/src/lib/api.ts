import type { Issue, QueueTask } from './types';

/** Both endpoints answer with an array. Anything else counts as empty. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${path} answered ${res.status}`);
  }
  return res.json();
}

export interface Snapshot {
  issues: Issue[];
  tasks: QueueTask[];
}

/**
 * Read the issue graph and the queue in one step. The caller shows an error
 * state when this throws, so neither request is swallowed.
 */
export async function fetchSnapshot(): Promise<Snapshot> {
  const [issues, tasks] = await Promise.all([
    getJson('/api/export'),
    getJson('/api/queue'),
  ]);
  return {
    issues: asArray<Issue>(issues),
    tasks: asArray<QueueTask>(tasks),
  };
}
