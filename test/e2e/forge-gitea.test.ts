import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubForgeServer } from "../helpers/stub-forge-server.ts";
import { waitFor } from "../helpers/wait.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Logger } from "../../src/log/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const agents: AgentConfig[] = [
	{ name: "code-agent", emoji: "+1" },
	{ name: "test-agent", emoji: "rocket" },
];

const owner = "org";
const repo = "repo";
const token = "e2e-token";

// E2E test: the orchestrator reports back over real HTTP.
// Real: StubForgeServer (HTTP), GiteaClient, ForgeWebhookSource (HTTP),
//       MentionParser, Orchestrator, MemoryQueue
// Mock: IssueTracker

describe("E2E: Gitea forge round trip", () => {
	let forge: StubForgeServer;
	let client: GiteaClient;
	let queue: MemoryQueue;
	let tracker: MockTracker;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	const webhookPort = 19972;

	/** Post a comment webhook and wait until it becomes a queued task. */
	async function mention(
		number: number,
		commentId: number,
		body: string,
	): Promise<void> {
		const before = queue.pendingCount;
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repo: { name: repo, owner: { name: owner } },
				issue: {
					number,
					title: "Some issue",
					html_url: `${forge.url}/${owner}/${repo}/issues/${number}`,
					user: { login: "human" },
				},
				comment: {
					id: commentId,
					body,
					html_url: `${forge.url}/${owner}/${repo}/issues/${number}#${commentId}`,
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);
		await waitFor(() => queue.pendingCount > before, {
			label: "task published",
		});
	}

	beforeAll(() => {
		forge = new StubForgeServer({ token });
		forge.start();

		tracker = new MockTracker();
		queue = new MemoryQueue();
		client = new GiteaClient(forge.forgeConfig(owner, repo));

		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "stub", client }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
		});

		const source = new ForgeWebhookSource(forge.forgeConfig(owner, repo), {
			port: webhookPort,
			secret: "",
		});
		stopWebhook = source.start((event) => {
			void orch.handleEvent(event);
		});
		stopWatching = orch.watchCompletions();
	});

	afterAll(() => {
		stopWatching();
		stopWebhook();
		forge.stop();
	});

	test("a completed task posts a comment over real HTTP", async () => {
		await mention(42, 500, "@code-agent fix the failing test");

		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();

		await queue.complete(task!.id, {
			status: "success",
			summary: "Fixed the failing test",
		});

		await waitFor(() => forge.commentsFor(owner, repo, 42).length === 1, {
			label: "completion comment on the forge",
		});
		const posted = forge.commentsFor(owner, repo, 42)[0]!;
		expect(posted.body).toContain("code-agent");
		expect(posted.body).toContain("Fixed the failing test");
	});

	test("the client sends the token on the real request", async () => {
		const post = forge.requests.find(
			(r) =>
				r.method === "POST" &&
				r.path === `/api/v1/repos/${owner}/${repo}/issues/42/comments`,
		);
		expect(post).toBeDefined();
		expect(post!.authorization).toBe(`token ${token}`);
	});

	test("a failed task posts a failure comment over real HTTP", async () => {
		await mention(43, 501, "@code-agent break something");

		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();

		await queue.fail(task!.id, {
			status: "failure",
			summary: "The build does not compile",
		});

		await waitFor(() => forge.commentsFor(owner, repo, 43).length === 1, {
			label: "failure comment on the forge",
		});
		const posted = forge.commentsFor(owner, repo, 43)[0]!;
		expect(posted.body).toContain("code-agent");
		expect(posted.body).toContain("The build does not compile");
	});
});
