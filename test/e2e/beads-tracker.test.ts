import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import { createFakeBd } from "../helpers/fake-bd.ts";
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

// E2E test: the real issue tracker runs in the scenario.
// Real: BeadsClient over a fake bd executable, StubGiteaServer (HTTP),
//       GiteaClient, ForgeWebhookSource (HTTP), MentionParser,
//       Orchestrator, MemoryQueue
// Mock: nothing. The bd binary is a shell script that answers like bd
//       and records every call.
//
// The other scenarios use an in-memory tracker, so the bd argv and the
// JSON parsing never run. This one runs them.

describe("E2E: the real beads tracker", () => {
	let forge: StubGiteaServer;
	let queue: MemoryQueue;
	let bdDir: string;
	let cleanupBd: () => void;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	const webhookPort = 19975;

	/** Every bd call the client made, one per line. */
	function bdCalls(): string[] {
		const log = join(bdDir, "bd-calls.log");
		if (!existsSync(log)) return [];
		return readFileSync(log, "utf-8").trim().split("\n").filter(Boolean);
	}

	beforeAll(() => {
		forge = new StubGiteaServer({ token: "token" });
		forge.start();

		const fake = createFakeBd();
		bdDir = fake.dir;
		cleanupBd = fake.cleanup;

		queue = new MemoryQueue();

		const orch = new Orchestrator({
			tracker: fake.client,
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
		cleanupBd();
	});

	test("a mention creates a beads issue and completion closes it", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: { number: 42, user: { login: "human" } },
				comment: {
					id: 600,
					body: "@code-agent fix the failing test",
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);
		await waitFor(() => queue.pendingCount === 1, { label: "task published" });

		// bd create ran, with the title and the labels the orchestrator sets.
		const create = bdCalls().find((c) => c.startsWith("create "));
		expect(create).toBeDefined();
		expect(create).toContain("[code-agent] fix the failing test");
		expect(create).toContain("--json");
		expect(create).toContain("--type task");
		expect(create).toContain("--labels code-agent,urgency-queued");

		// The id bd printed is the id the task carries.
		const task = await queue.claim("code-agent");
		expect(task!.issueId).toBe("test-abc.1");

		await queue.complete(task!.id, {
			status: "success",
			summary: "Fixed the failing test",
		});

		await waitFor(() => bdCalls().some((c) => c.startsWith("close ")), {
			label: "bd close",
		});
		expect(bdCalls()).toContain("close test-abc.1");
	});

	test("a failure marks the beads issue blocked", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: { number: 43, user: { login: "human" } },
				comment: {
					id: 601,
					body: "@code-agent break the build",
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);
		await waitFor(() => queue.pendingCount === 1, { label: "task published" });

		const task = await queue.claim("code-agent");
		// A second create, so a second id.
		expect(task!.issueId).toBe("test-abc.2");

		await queue.fail(task!.id, {
			status: "failure",
			summary: "The build does not compile",
		});

		await waitFor(
			() => bdCalls().some((c) => c.includes("--status blocked")),
			{ label: "bd update to blocked" },
		);
		expect(bdCalls()).toContain(
			"update test-abc.2 --json --status blocked",
		);
	});
});
