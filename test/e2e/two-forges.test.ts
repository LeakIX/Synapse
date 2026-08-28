import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { GitHubClient } from "../../src/forge/github.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import {
	StubGiteaServer,
	StubGitHubServer,
} from "../helpers/stub-forge-server.ts";
import { waitFor } from "../helpers/wait.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Logger } from "../../src/log/types.ts";
import type { QueueTask } from "../../src/queue/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const agents: AgentConfig[] = [{ name: "code-agent", emoji: "+1" }];

const owner = "org";
const repo = "repo";

// E2E test: one webhook server serves two forges at once.
// Real: StubGiteaServer and StubGitHubServer (HTTP), GiteaClient and
//       GitHubClient, ForgeWebhookSource (HTTP), MentionParser,
//       Orchestrator, MemoryQueue
// Mock: IssueTracker
//
// The composition root used to build one server per forge on one shared
// port, so the second forge could never bind. One server now serves both
// and the path names the forge.

describe("E2E: two forges on one webhook server", () => {
	let gitea: StubGiteaServer;
	let github: StubGitHubServer;
	let queue: MemoryQueue;
	let source: ForgeWebhookSource;
	let stopWebhook: () => void;
	const webhookPort = 19974;

	/** Post a comment webhook to one forge path. Returns the status. */
	async function mention(path: string, number: number): Promise<number> {
		const res = await fetch(`http://localhost:${webhookPort}${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: {
					number,
					title: "Some issue",
					user: { login: "human" },
				},
				comment: {
					id: 900 + number,
					body: "@code-agent fix the failing test",
					user: { login: "human" },
				},
			}),
		});
		return res.status;
	}

	beforeAll(() => {
		gitea = new StubGiteaServer({ token: "gitea-token" });
		gitea.start();
		github = new StubGitHubServer({ token: "github-token" });
		github.start();

		queue = new MemoryQueue();

		const orch = new Orchestrator({
			tracker: new MockTracker(),
			queue,
			forges: [
				{
					name: "gitea",
					client: new GiteaClient(gitea.forgeConfig(owner, repo)),
				},
				{
					name: "github",
					client: new GitHubClient(github.forgeConfig(owner, repo)),
				},
			],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
		});

		source = new ForgeWebhookSource(
			[
				{ ...gitea.forgeConfig(owner, repo), name: "gitea" },
				{ ...github.forgeConfig(owner, repo), name: "github" },
			],
			{ port: webhookPort, secret: "" },
		);
		stopWebhook = source.start((event) => {
			void orch.handleEvent(event);
		});
	});

	afterAll(() => {
		stopWebhook();
		gitea.stop();
		github.stop();
	});

	test("both forges reach the orchestrator through one server", async () => {
		expect(await mention(source.pathFor("gitea"), 42)).toBe(200);
		await waitFor(() => queue.pendingCount === 1, {
			label: "task from the Gitea hook",
		});

		expect(await mention(source.pathFor("github"), 43)).toBe(200);
		await waitFor(() => queue.pendingCount === 2, {
			label: "task from the GitHub hook",
		});

		const tasks: QueueTask[] = [];
		for (let i = 0; i < 2; i++) {
			const task = await queue.claim("code-agent");
			expect(task).not.toBeNull();
			tasks.push(task!);
		}
		expect(tasks.map((t) => t.forgeContext?.number).sort()).toEqual([42, 43]);
	});

	test("an unnamed path is refused when two forges are configured", async () => {
		expect(await mention("/", 44)).toBe(404);
		expect(await mention("/webhook/gitlab", 45)).toBe(404);
		expect(queue.pendingCount).toBe(0);
	});
});
