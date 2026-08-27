import type {
	Issue,
	CreateIssueOpts,
	ListFilter,
	IssueTracker,
} from "../../src/issues/types.ts";

/**
 * In-memory IssueTracker for tests.
 */
export class MockTracker implements IssueTracker {
	issues = new Map<string, Issue>();
	#counter = 0;

	async create(title: string, opts?: CreateIssueOpts): Promise<Issue> {
		this.#counter++;
		const id = `mock-${this.#counter}`;
		const now = new Date().toISOString();
		const issue: Issue = {
			id,
			title,
			description: opts?.description ?? "",
			status: "open",
			priority: opts?.priority ?? 2,
			type: opts?.type ?? "task",
			externalRef: opts?.externalRef,
			parent: opts?.parent,
			labels: opts?.labels ?? [],
			createdAt: now,
			updatedAt: now,
		};
		this.issues.set(id, issue);
		return issue;
	}

	async update(
		id: string,
		fields: Partial<Pick<Issue, "title" | "description" | "status" | "priority">>,
	): Promise<Issue> {
		const issue = this.issues.get(id);
		if (!issue) throw new Error(`issue not found: ${id}`);
		if (fields.title !== undefined) issue.title = fields.title;
		if (fields.description !== undefined) issue.description = fields.description;
		if (fields.status !== undefined) issue.status = fields.status;
		if (fields.priority !== undefined) issue.priority = fields.priority;
		issue.updatedAt = new Date().toISOString();
		return issue;
	}

	async close(id: string): Promise<void> {
		const issue = this.issues.get(id);
		if (!issue) throw new Error(`issue not found: ${id}`);
		issue.status = "closed";
		issue.updatedAt = new Date().toISOString();
	}

	async show(id: string): Promise<Issue> {
		const issue = this.issues.get(id);
		if (!issue) throw new Error(`issue not found: ${id}`);
		return issue;
	}

	async list(_filter?: ListFilter): Promise<Issue[]> {
		return [...this.issues.values()];
	}

	async addDependency(
		_blockedId: string,
		_blockerId: string,
	): Promise<void> {
		// no-op in mock
	}

	async removeDependency(
		_blockedId: string,
		_blockerId: string,
	): Promise<void> {
		// no-op in mock
	}

	/** Test helper: get issue by ID or throw. */
	get(id: string): Issue {
		const issue = this.issues.get(id);
		if (!issue) throw new Error(`issue not found: ${id}`);
		return issue;
	}

	/** Test helper: total issue count. */
	get count(): number {
		return this.issues.size;
	}
}