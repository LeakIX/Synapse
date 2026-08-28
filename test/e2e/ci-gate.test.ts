import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { CiGate } from "../../src/core/ci-gate.ts";
import { DroneClient } from "../../src/ci/drone.ts";
import { FileQueue } from "../../src/queue/file.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import { StubCiServer } from "../helpers/stub-ci-server.ts";
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

// E2E test: the CI gate holds a follow-up task and releases it later.
// Real: StubCiServer (HTTP), DroneClient, CiGate, StubGiteaServer
//       (HTTP), GiteaClient, ForgeWebhookSource (HTTP), MentionParser,
//       Orchestrator, FileQueue on disk
// Mock: IssueTracker
//
// The gate held a task and dropped it before, because nothing asked the
// gate a second time. This scenario proves the whole path: the queue
// parks the task on disk, the housekeeping tick asks the real CI server
// again, and the task reaches an agent once the build passes.

describe("E2E: the CI gate holds a task and releases it", () => {
	let forge: StubGiteaServer;
	let ci: StubCiServer;
	let tracker: MockTracker;
	let queue: FileQueue;
	let queueDir: string;
	let orch: Orchestrator;
	let stopWebhook: () => void;
	let stopHousekeeping: () => void;
	const webhookPort = 19981;

	/** Names of the task files in one queue directory. */
	function files(sub: string): string[] {
		const dir = join(queueDir, sub);
		return existsSync(dir)
			? readdirSync(dir).filter((f) => f.endsWith(".json"))
			: [];
	}

	beforeAll(() => {
		forge = new StubGiteaServer({ token: "token" });
		forge.start();

		ci = new StubCiServer({ token: "ci-token", status: "failed" });
		ci.start();

		queueDir = mkdtempSync(join(tmpdir(), "synapse-gate-"));
		queue = new FileQueue(queueDir);
		tracker = new MockTracker();

		orch = new Orchestrator({
			tracker,
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
			ciGate: new CiGate(
				new DroneClient(ci.ciConfig("drone", "gitea")),
				silentLogger,
				owner,
				repo,
			),
		});

		const source = new ForgeWebhookSource(
			[{ ...forge.forgeConfig(owner, repo), name: "gitea" }],
			{ port: webhookPort, secret: "" },
		);
		stopWebhook = source.start((event) => {
			void orch.handleEvent(event);
		});
		stopHousekeeping = orch.startHousekeeping({ intervalMs: 25 });
	});

	afterAll(() => {
		stopHousekeeping();
		stopWebhook();
		ci.stop();
		forge.stop();
		rmSync(queueDir, { recursive: true, force: true });
	});

	test("a failing build holds the task, a passing build releases it", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: { number: 42, user: { login: "human" } },
				comment: {
					id: 800,
					body: "@code-agent fix the failing test in PR #42",
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);

		// 1. The build fails, so the queue parks the task in held.
		await waitFor(() => files("held").length === 1, {
			label: "task file in held",
		});
		expect(files("pending")).toHaveLength(0);
		expect(ci.buildRequestCount).toBeGreaterThan(0);

		// 2. The issue says blocked, so a human sees why nothing runs.
		const issue = tracker.issues.values().next().value!;
		expect(issue.status).toBe("blocked");

		// 3. No agent can claim a held task.
		expect(await queue.claim("code-agent")).toBeNull();

		// 4. The build passes. The housekeeping tick releases the task.
		ci.status = "passed";
		await waitFor(() => files("pending").length === 1, {
			label: "task file moves to pending",
			timeoutMs: 5000,
		});
		expect(files("held")).toHaveLength(0);
		expect(tracker.get(issue.id).status).toBe("open");

		// 5. The agent claims the task the gate held.
		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();
		expect(task!.followUpAfter).toBe(42);
		expect(task!.instruction).toContain("fix the failing test");
	});
});
