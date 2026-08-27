/** Lifecycle state of an issue. */
export type IssueStatus =
	| "open"
	| "in_progress"
	| "blocked"
	| "closed"
	| "deferred";

/** A tracked issue in the issue tracker. */
export interface Issue {
	/** Tracker-specific unique ID (e.g. beads ID like "leakix-82c.19"). */
	id: string;
	title: string;
	description: string;
	status: IssueStatus;
	/** 0 (critical) through 4 (nice to have). */
	priority: number;
	type: "task" | "epic" | "bug";
	/** External reference, e.g. "pr:246" or "issue:123". */
	externalRef?: string;
	/** Parent issue ID, for hierarchical tracking. */
	parent?: string;
	labels: string[];
	/** ISO timestamp. */
	createdAt: string;
	/** ISO timestamp. */
	updatedAt: string;
}

/** Options for creating a new issue. All optional except title (separate param). */
export interface CreateIssueOpts {
	description?: string;
	type?: "task" | "epic" | "bug";
	priority?: number;
	parent?: string;
	labels?: string[];
	/** External reference to link the issue to a PR or forge issue. */
	externalRef?: string;
}

/** Filter for listing issues. All optional; omitted fields are unconstrained. */
export interface ListFilter {
	status?: IssueStatus;
	label?: string;
	parent?: string;
}

/**
 * Abstraction over the issue tracker (beads, GitHub issues, Linear, ...).
 * The orchestrator depends on this interface, never on a concrete tracker.
 */
export interface IssueTracker {
	/** Create a new issue. Returns the created issue with its assigned ID. */
	create(title: string, opts?: CreateIssueOpts): Promise<Issue>;
	/** Update mutable fields on an existing issue. */
	update(
		id: string,
		fields: Partial<Pick<Issue, "title" | "description" | "status" | "priority">>,
	): Promise<Issue>;
	/** Close an issue. */
	close(id: string): Promise<void>;
	/** Fetch a single issue by ID. Throws if not found. */
	show(id: string): Promise<Issue>;
	/** List issues, optionally filtered. */
	list(filter?: ListFilter): Promise<Issue[]>;
	/** Add a blocking dependency: blockedId cannot start until blockerId is closed. */
	addDependency(blockedId: string, blockerId: string): Promise<void>;
	/** Remove a previously added dependency. */
	removeDependency(blockedId: string, blockerId: string): Promise<void>;
}