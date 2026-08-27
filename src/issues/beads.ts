import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	Issue,
	IssueStatus,
	IssueType,
	CreateIssueOpts,
	ListFilter,
	IssueTracker,
} from "./types.ts";

const pExecFile = promisify(execFile);

/**
 * IssueTracker backed by the bd (beads) CLI.
 * Shells out to bd with --json output and parses the result.
 */
export class BeadsClient implements IssueTracker {
	#dir: string;
	#binary: string;

	constructor(dir: string, binary: string = "bd") {
		this.#dir = dir;
		this.#binary = binary;
	}

	async create(title: string, opts?: CreateIssueOpts): Promise<Issue> {
		const args = ["create", title, "--json"];
		if (opts?.description) args.push("--description", opts.description);
		if (opts?.type) args.push("--type", opts.type);
		if (opts?.priority !== undefined)
			args.push("--priority", String(opts.priority));
		if (opts?.externalRef) args.push("--external-ref", opts.externalRef);
		const labels = opts?.labels ?? [];
		if (labels.length > 0) args.push("--labels", labels.join(","));

		const { stdout } = await pExecFile(this.#binary, args, {
			cwd: this.#dir,
			encoding: "utf-8",
		});
		const parsed = JSON.parse(stdout) as Record<string, unknown>;
		return this.#toIssue(parsed);
	}

	async update(
		id: string,
		fields: Partial<Pick<Issue, "title" | "description" | "status" | "priority">>,
	): Promise<Issue> {
		const args = ["update", id, "--json"];
		if (fields.title !== undefined) args.push("--title", fields.title);
		if (fields.description !== undefined)
			args.push("--description", fields.description);
		if (fields.status !== undefined) args.push("--status", fields.status);
		if (fields.priority !== undefined)
			args.push("--priority", String(fields.priority));

		const { stdout } = await pExecFile(this.#binary, args, {
			cwd: this.#dir,
			encoding: "utf-8",
		});
		return this.#toIssue(JSON.parse(stdout) as Record<string, unknown>);
	}

	async close(id: string): Promise<void> {
		await pExecFile(this.#binary, ["close", id], {
			cwd: this.#dir,
			encoding: "utf-8",
		});
	}

	async show(id: string): Promise<Issue> {
		const { stdout } = await pExecFile(
			this.#binary,
			["show", id, "--json"],
			{ cwd: this.#dir, encoding: "utf-8" },
		);
		return this.#toIssue(JSON.parse(stdout) as Record<string, unknown>);
	}

	async list(filter?: ListFilter): Promise<Issue[]> {
		const args = ["list", "--json"];
		if (filter?.status) args.push("--status", filter.status);
		if (filter?.label) args.push("--label", filter.label);

		const { stdout } = await pExecFile(this.#binary, args, {
			cwd: this.#dir,
			encoding: "utf-8",
		});
		const parsed = JSON.parse(stdout) as Record<string, unknown>[];
		return parsed.map((p) => this.#toIssue(p));
	}

	async addDependency(blockedId: string, blockerId: string): Promise<void> {
		await pExecFile(this.#binary, ["link", blockedId, blockerId], {
			cwd: this.#dir,
			encoding: "utf-8",
		});
	}

	async removeDependency(blockedId: string, blockerId: string): Promise<void> {
		await pExecFile(this.#binary, ["dep", "remove", blockedId, blockerId], {
			cwd: this.#dir,
			encoding: "utf-8",
		});
	}

	#toIssue(raw: Record<string, unknown>): Issue {
		return {
			id: String(raw.id ?? ""),
			title: String(raw.title ?? ""),
			description: String(raw.description ?? ""),
			status: (raw.status as IssueStatus) ?? "open",
			priority: Number(raw.priority ?? 2),
			type: (raw.type as IssueType) ?? "task",
			externalRef: raw.externalRef as string | undefined,
			parent: raw.parent as string | undefined,
			labels: (raw.labels as string[]) ?? [],
			createdAt: String(
				raw.created_at ?? raw.createdAt ?? new Date().toISOString(),
			),
			updatedAt: String(
				raw.updated_at ?? raw.updatedAt ?? new Date().toISOString(),
			),
		};
	}
}