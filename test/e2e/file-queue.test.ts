import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { FileQueue } from "../../src/queue/file.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import { waitFor } from "../helpers/wait.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Logger } from "../../src/log/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const agents: AgentConfig[] = [{ name: "code-agent", emoji: "+1" }];

const owner = "org";
const repo = "repo";

// E2E test: the real file queue runs in the scenario.
// Real: FileQueue on disk, StubGiteaServer (HTTP), GiteaClient,
//       ForgeWebhookSource (HTTP), MentionParser, Orchestrator
// Mock: IssueTracker
//
// The other scenarios use the in-memory queue, which never touches the
// disk and calls the watchers directly. This one proves the layout on
// disk, the rename that claims a task, and the watcher that polls the
// done directory.

describe("E2E: the real file queue", () => {
	let forge: StubGiteaServer;
	let queue: FileQueue;
	let queueDir: string;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	const webhookPort = 19976;

	/** Names of the task files in one queue directory. */
	function files(sub: string): string[] {
		const dir = join(queueDir, sub);
		return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
	}

	beforeAll(() => {
		forge = new StubGiteaServer({ token: "token" });
		forge.start();

		queueDir = mkdtempSync(join(tmpdir(), "synapse-queue-"));
		queue = new FileQueue(queueDir);

		const orch = new Orchestrator({
			tracker: new MockTracker(),
			queue,
			forges: [
				{
					name: "gitea",
					client: new GiteaClient(forge.forgeConfig(owner, repo)),
				},
			],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
		});

		const source = new ForgeWebhookSource(
			[{ ...forge.forgeConfig(owner, repo), name: "gitea" }],
			{ port: webhookPort, secret: "" },
		);
		stopWebhook = source.start((event) => {
			void orch.handleEvent(event);
		});
		stopWatching = orch.watchCompletions();
	});

	afterAll(() => {
		stopWatching();
		stopWebhook();
		forge.stop();
		rmSync(queueDir, { recursive: true, force: true });
	});

	test("a task walks pending, active, done, and archive on disk", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: { number: 42, user: { login: "human" } },
				comment: {
					id: 700,
					body: "@code-agent fix the failing test",
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);

		// 1. The orchestrator wrote one file in pending.
		await waitFor(() => files("pending").length === 1, {
			label: "task file in pending",
		});

		// 2. Claiming renames it into active.
		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();
		expect(task!.claimedAt).toBeDefined();
		expect(files("pending")).toHaveLength(0);
		expect(files("active")).toEqual([`${task!.id}.json`]);

		// 3. Completing renames it into done.
		await queue.complete(task!.id, {
			status: "success",
			summary: "Fixed the failing test",
		});
		expect(files("active")).toHaveLength(0);

		// 4. The watcher polls done, comments on the forge, and archives.
		await waitFor(() => forge.commentsFor(owner, repo, 42).length === 1, {
			label: "reply on the forge",
			timeoutMs: 5000,
		});
		await waitFor(() => files("done").length === 0, {
			label: "task file leaves done",
			timeoutMs: 5000,
		});
		expect(files("archive")).toContain(`${task!.id}.json`);
	});

	test("a claim takes only the tasks of the named agent", async () => {
		await queue.publish({
			id: "task-for-someone-else",
			issueId: "mock-99",
			agent: "other-agent",
			instruction: "not yours",
			urgency: "queued",
			createdAt: new Date().toISOString(),
		});

		expect(await queue.claim("code-agent")).toBeNull();
		expect(files("pending")).toEqual(["task-for-someone-else.json"]);

		const mine = await queue.claim("other-agent");
		expect(mine!.id).toBe("task-for-someone-else");
		await queue.archive(mine!.id);
	});

	test("detectStale finds a task an agent claimed and abandoned", async () => {
		await queue.publish({
			id: "abandoned-task",
			issueId: "mock-100",
			agent: "code-agent",
			instruction: "claim me and stop",
			urgency: "queued",
			createdAt: new Date().toISOString(),
		});
		const claimed = await queue.claim("code-agent");
		expect(claimed!.id).toBe("abandoned-task");

		// Nothing is stale within the hour.
		expect(await queue.detectStale(3_600_000)).toHaveLength(0);

		// Everything is stale once it is older than the timeout. The age
		// is compared with a strict greater than, so a task claimed in
		// this same millisecond is not stale yet. Poll instead of
		// assuming that a millisecond has passed.
		await waitFor(async () => (await queue.detectStale(0)).length === 1, {
			label: "the abandoned task turns stale",
		});
		const stale = await queue.detectStale(0);
		expect(stale.map((t) => t.id)).toEqual(["abandoned-task"]);

		await queue.archive("abandoned-task");
	});
});
