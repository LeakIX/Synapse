/** Context for reporting back to the forge. */
export interface ForgeContext {
	/** Name of the forge the event came from, as configured. */
	forge?: string;
	owner: string;
	repo: string;
	/** Issue or PR number to comment on. */
	number: number;
	/** Specific comment to react to, if known. */
	commentId?: number;
	/** Canonical URL for the comment. */
	url: string;
}

/** The outcome of an agent completing a task. */
export type TaskStatus = "success" | "failure";

/** How urgently a task should be dispatched. */
export type Urgency = "now" | "queued";

/** The result of an agent completing (or failing) a task. */
export interface TaskResult {
	status: TaskStatus;
	/** One-line summary of what the agent did or why it failed. */
	summary: string;
	/** Optional detailed output (e.g. agent stdout). */
	output?: string;
}

/** A unit of work dispatched to an agent. */
export interface QueueTask {
	/** Unique task ID (UUID). */
	id: string;
	/** The IssueTracker issue this task maps to. */
	issueId: string;
	/** Which agent should perform this task. */
	agent: string;
	/** Natural-language instruction for the agent. */
	instruction: string;
	/** Where to report back on the forge, if the task came from a forge event. */
	forgeContext?: ForgeContext;
	/** PR/issue number this task is a follow-up of. */
	followUpAfter?: number;
	/** "now" = urgent, "queued" = when the agent is free. */
	urgency: Urgency;
	/** ISO timestamp of when the task was created. */
	createdAt: string;
	/** ISO timestamp of when an agent claimed the task. */
	claimedAt?: string;
	/** ISO timestamp of when the agent finished. */
	completedAt?: string;
	/** Set when the agent completes or fails. */
	result?: TaskResult;
}

/**
 * Abstraction over the task queue (file-based, NSQ, Redis, in-memory, ...).
 * The orchestrator publishes and watches; agents claim and complete.
 */
export interface TaskQueue {
	/** Place a task in the queue for an agent to pick up. */
	publish(task: QueueTask): Promise<void>;
	/** Watch for completed tasks. Returns a stop function. */
	watchDone(onDone: (task: QueueTask) => void): () => void;
	/** Watch for failed tasks. Returns a stop function. */
	watchFailed(onFailed: (task: QueueTask) => void): () => void;
	/** Move a processed task to the archive. */
	archive(taskId: string): Promise<void>;

	/**
	 * Park a task that cannot run yet, so no agent claims it. A held
	 * task survives a restart, the way a pending task does.
	 */
	hold(task: QueueTask): Promise<void>;
	/** Every task that waits on a gate. */
	listHeld(): Promise<QueueTask[]>;
	/**
	 * Move a held task into pending, so an agent can claim it. Returns
	 * the task, or null when it is no longer held.
	 */
	release(taskId: string): Promise<QueueTask | null>;

	/** Agent side: atomically claim the next task for this agent. Null if none. */
	claim(agentName: string): Promise<QueueTask | null>;
	/** Agent side: mark a task as successfully completed. */
	complete(taskId: string, result: TaskResult): Promise<void>;
	/** Agent side: mark a task as failed. */
	fail(taskId: string, result: TaskResult): Promise<void>;

	/** Housekeeping: find tasks claimed longer than timeoutMs ago. */
	detectStale(timeoutMs: number): Promise<QueueTask[]>;
}