import type { QueueTask, TaskQueue, TaskResult } from "./types.ts";

type DoneCallback = (task: QueueTask) => void;
type FailedCallback = (task: QueueTask) => void;

/**
 * In-memory TaskQueue for tests.
 * Synchronous, no filesystem, no polling.
 */
export class MemoryQueue implements TaskQueue {
	#pending = new Map<string, QueueTask>();
	#active = new Map<string, QueueTask>();
	#held = new Map<string, QueueTask>();
	#done: QueueTask[] = [];
	#failed: QueueTask[] = [];
	#doneCbs: DoneCallback[] = [];
	#failedCbs: FailedCallback[] = [];

	async publish(task: QueueTask): Promise<void> {
		this.#pending.set(task.id, task);
	}

	watchDone(onDone: DoneCallback): () => void {
		this.#doneCbs.push(onDone);
		return () => {
			const idx = this.#doneCbs.indexOf(onDone);
			if (idx !== -1) this.#doneCbs.splice(idx, 1);
		};
	}

	watchFailed(onFailed: FailedCallback): () => void {
		this.#failedCbs.push(onFailed);
		return () => {
			const idx = this.#failedCbs.indexOf(onFailed);
			if (idx !== -1) this.#failedCbs.splice(idx, 1);
		};
	}

	async archive(_taskId: string): Promise<void> {
		// no-op in memory
	}

	async hold(task: QueueTask): Promise<void> {
		this.#held.set(task.id, task);
	}

	async listHeld(): Promise<QueueTask[]> {
		return [...this.#held.values()];
	}

	async release(taskId: string): Promise<QueueTask | null> {
		const task = this.#held.get(taskId);
		if (!task) return null;
		this.#held.delete(taskId);
		this.#pending.set(taskId, task);
		return task;
	}

	/** Test helper: get held task count. */
	get heldCount(): number {
		return this.#held.size;
	}

	async claim(agentName: string): Promise<QueueTask | null> {
		for (const [id, task] of this.#pending) {
			if (task.agent !== agentName) continue;
			this.#pending.delete(id);
			task.claimedAt = new Date().toISOString();
			this.#active.set(id, task);
			return task;
		}
		return null;
	}

	async complete(taskId: string, result: TaskResult): Promise<void> {
		const task = this.#active.get(taskId);
		if (!task) throw new Error(`task ${taskId} not active`);
		this.#active.delete(taskId);
		task.completedAt = new Date().toISOString();
		task.result = result;
		this.#done.push(task);
		for (const cb of this.#doneCbs) cb(task);
	}

	async fail(taskId: string, result: TaskResult): Promise<void> {
		const task = this.#active.get(taskId);
		if (!task) throw new Error(`task ${taskId} not active`);
		this.#active.delete(taskId);
		task.completedAt = new Date().toISOString();
		task.result = result;
		this.#failed.push(task);
		for (const cb of this.#failedCbs) cb(task);
	}

	async detectStale(timeoutMs: number): Promise<QueueTask[]> {
		const now = Date.now();
		return [...this.#active.values()].filter((t) => {
			if (!t.claimedAt) return false;
			return now - new Date(t.claimedAt).getTime() > timeoutMs;
		});
	}

	/** Test helper: get all done tasks. */
	get done(): readonly QueueTask[] {
		return this.#done;
	}

	/** Test helper: get all failed tasks. */
	get failed(): readonly QueueTask[] {
		return this.#failed;
	}

	/** Test helper: get pending task count. */
	get pendingCount(): number {
		return this.#pending.size;
	}

	/** Test helper: get active task count. */
	get activeCount(): number {
		return this.#active.size;
	}
}