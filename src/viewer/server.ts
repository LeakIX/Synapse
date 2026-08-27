import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

import type { TaskStatus, Urgency } from "../queue/types.ts";
import type { IssueStatus, IssueType } from "../issues/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BdIssue {
	id: string;
	title: string;
	description: string;
	status: IssueStatus;
	priority: number;
	issue_type: IssueType;
	owner?: string;
	created_at: string;
	external_ref?: string;
	labels: string[];
	dependencies: Array<{
		issue_id: string;
		depends_on_id: string;
		type: string;
	}>;
	parent?: string;
}

interface QueueTaskFile {
	id: string;
	issueId: string;
	agent: string;
	instruction: string;
	urgency: Urgency;
	createdAt: string;
	claimedAt?: string;
	completedAt?: string;
	result?: { status: TaskStatus; summary: string };
}

interface QueueTaskView {
	id: string;
	issue_id: string;
	agent: string;
	state: "pending" | "active" | "done" | "failed";
	claimed_at?: string;
	completed_at?: string;
	result?: string;
}

function parseArgs() {
	const args = process.argv.slice(2);
	let port = 8090;
	let dir = ".";
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--port" && i + 1 < args.length) {
			port = Number(args[i + 1]);
			i++;
		} else if (args[i] === "--dir" && i + 1 < args.length) {
			dir = args[i + 1];
			i++;
		} else if (args[i] === "--bd" && i + 1 < args.length) {
			(bdBinary as string) = args[i + 1];
			i++;
		}
	}
	return { port, dir };
}

let bdBinary = "bd";

async function bdList(dir: string): Promise<BdIssue[]> {
	try {
		const { stdout } = await pExecFile(bdBinary, ["list", "--json"], {
			cwd: dir,
			encoding: "utf-8",
			timeout: 30000,
		});
		return JSON.parse(stdout);
	} catch {
		return [];
	}
}

async function readQueue(dir: string): Promise<QueueTaskView[]> {
	const queueDir = join(dir, "queue");
	const result: QueueTaskView[] = [];
	const dirs: Array<[string, QueueTaskView["state"]]> = [
		["pending", "pending"],
		["active", "active"],
		["done", "done"],
		["failed", "failed"],
	];
	for (const [sub, state] of dirs) {
		const full = join(queueDir, sub);
		try {
			const { readdirSync, readFileSync: rfs } = await import("node:fs");
			const files = readdirSync(full).filter((f: string) => f.endsWith(".json"));
			for (const f of files) {
				try {
					const raw = rfs(join(full, f), "utf-8");
					const t = JSON.parse(raw) as QueueTaskFile;
					result.push({
						id: t.id,
						issue_id: t.issueId,
						agent: t.agent,
						state,
						claimed_at: t.claimedAt,
						completed_at: t.completedAt,
						result: t.result?.summary,
					} as QueueTaskView);
				} catch {
					// skip unparseable
				}
			}
		} catch {
			// dir doesn't exist
		}
	}
	return result;
}

export function startViewer(port: number, repoDir: string) {
	const html = readFileSync(join(__dirname, "index.html"), "utf-8");

	const server = Bun.serve({
		port,
		async fetch(req: Request) {
			const url = new URL(req.url);

			if (url.pathname === "/") {
				return new Response(html, {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}

			if (url.pathname === "/api/export") {
				const issues = await bdList(repoDir);
				return Response.json(issues);
			}

			if (url.pathname === "/api/queue") {
				const tasks = await readQueue(repoDir);
				return Response.json(tasks);
			}

			if (url.pathname === "/api/health") {
				return Response.json({ status: "ok" });
			}

			return new Response("Not Found", { status: 404 });
		},
	});

	console.log(
		`viewer on http://localhost:${port} (dir: ${repoDir}, bd: ${bdBinary})`,
	);

	return {
		stop: () => server.stop(),
	};
}

if (import.meta.main) {
	const { port, dir } = parseArgs();
	const resolved = join(process.cwd(), dir);
	startViewer(port, resolved);
}