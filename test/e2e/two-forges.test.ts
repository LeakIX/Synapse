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
	let stopWatching: () => void;
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
		stopWatching = orch.watchCompletions();
	});

	afterAll(() => {
		stopWatching();
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

	test("each reply lands on the forge the mention came from", async () => {
		// Gitea first.
		expect(await mention(source.pathFor("gitea"), 50)).toBe(200);
		await waitFor(() => queue.pendingCount === 1, { label: "gitea task" });
		const giteaTask = await queue.claim("code-agent");
		expect(giteaTask!.forgeContext?.forge).toBe("gitea");
		await queue.complete(giteaTask!.id, {
			status: "success",
			summary: "Fixed it on Gitea",
		});
		await waitFor(() => gitea.commentsFor(owner, repo, 50).length === 1, {
			label: "reply on the Gitea forge",
		});
		expect(github.commentsFor(owner, repo, 50)).toHaveLength(0);

		// GitHub next.
		expect(await mention(source.pathFor("github"), 51)).toBe(200);
		await waitFor(() => queue.pendingCount === 1, { label: "github task" });
		const githubTask = await queue.claim("code-agent");
		expect(githubTask!.forgeContext?.forge).toBe("github");
		await queue.complete(githubTask!.id, {
			status: "success",
			summary: "Fixed it on GitHub",
		});
		await waitFor(() => github.commentsFor(owner, repo, 51).length === 1, {
			label: "reply on the GitHub forge",
		});
		expect(gitea.commentsFor(owner, repo, 51)).toHaveLength(0);

		// Each forge saw only its own request.
		expect(
			gitea.requests.some((r) => r.path.includes("/issues/51/")),
		).toBe(false);
		expect(
			github.requests.some((r) => r.path.includes("/issues/50/")),
		).toBe(false);
	});

	test("an unnamed path is refused when two forges are configured", async () => {
		expect(await mention("/", 44)).toBe(404);
		expect(await mention("/webhook/gitlab", 45)).toBe(404);
		expect(queue.pendingCount).toBe(0);
	});
});
