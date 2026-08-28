import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import type { StubComment } from "../helpers/stub-forge-server.ts";
import { waitFor } from "../helpers/wait.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Logger } from "../../src/log/types.ts";
import type { TaskStatus } from "../../src/queue/types.ts";

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
// Real: StubGiteaServer (HTTP), GiteaClient, ForgeWebhookSource (HTTP),
//       MentionParser, Orchestrator, MemoryQueue
// Mock: IssueTracker
//
// Each test owns its state. The stub server resets before each test, and
// each test drives the round trip it asserts on. No test reads what
// another test left behind, so you can run one test on its own.

describe("E2E: Gitea forge round trip", () => {
	let forge: StubGiteaServer;
	let client: GiteaClient;
	let queue: MemoryQueue;
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

	/**
	 * Drive one task from the mention to the reply on the forge.
	 * Returns the comment the orchestrator posted.
	 */
	async function roundTrip(opts: {
		number: number;
		commentId: number;
		instruction: string;
		summary: string;
		outcome?: TaskStatus;
	}): Promise<StubComment> {
		await mention(opts.number, opts.commentId, opts.instruction);

		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();

		const result = {
			status: opts.outcome ?? ("success" as TaskStatus),
			summary: opts.summary,
		};
		if (result.status === "success") {
			await queue.complete(task!.id, result);
		} else {
			await queue.fail(task!.id, result);
		}

		await waitFor(
			() => forge.commentsFor(owner, repo, opts.number).length === 1,
			{ label: `reply on issue ${opts.number}` },
		);
		return forge.commentsFor(owner, repo, opts.number)[0]!;
	}

	beforeAll(() => {
		forge = new StubGiteaServer({ token });
		forge.start();

		queue = new MemoryQueue();
		client = new GiteaClient(forge.forgeConfig(owner, repo));

		const orch = new Orchestrator({
			tracker: new MockTracker(),
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

	beforeEach(() => {
		forge.reset();
	});

	afterAll(() => {
		stopWatching();
		stopWebhook();
		forge.stop();
	});

	test("a completed task posts a comment over real HTTP", async () => {
		const posted = await roundTrip({
			number: 42,
			commentId: 500,
			instruction: "@code-agent fix the failing test",
			summary: "Fixed the failing test",
		});

		expect(posted.body).toContain("code-agent");
		expect(posted.body).toContain("Fixed the failing test");
	});

	test("the client sends the token on the real request", async () => {
		await roundTrip({
			number: 45,
			commentId: 503,
			instruction: "@code-agent update the docs",
			summary: "Updated the docs",
		});

		const post = forge.requests.find(
			(r) =>
				r.method === "POST" &&
				r.path === `/api/v1/repos/${owner}/${repo}/issues/45/comments`,
		);
		expect(post).toBeDefined();
		expect(post!.authorization).toBe(`token ${token}`);
	});

	test("a failed task posts a failure comment over real HTTP", async () => {
		const posted = await roundTrip({
			number: 43,
			commentId: 501,
			instruction: "@code-agent break something",
			summary: "The build does not compile",
			outcome: "failure",
		});

		expect(posted.body).toContain("code-agent");
		expect(posted.body).toContain("The build does not compile");
	});

	test("the posted comment reads back through the API", async () => {
		const posted = await roundTrip({
			number: 46,
			commentId: 504,
			instruction: "@code-agent add the test",
			summary: "Added the test",
		});

		const fetched = await client.getComment(owner, repo, 46, posted.id);
		expect(fetched.id).toBe(posted.id);
		expect(fetched.body).toBe(posted.body);

		const all = await client.listComments(owner, repo, 46);
		expect(all).toHaveLength(1);
		expect(all[0]!.id).toBe(posted.id);
	});

	test("a reaction lands on the mentioned comment", async () => {
		const seeded = forge.seedComment(owner, repo, 44, {
			author: "human",
			body: "@code-agent take a look",
		});

		await client.react(owner, repo, 44, seeded.id, "+1");

		expect(forge.reactionsFor(seeded.id)).toEqual([
			{ commentId: seeded.id, content: "+1" },
		]);
	});

	test("a seeded pull request reads back through the API", async () => {
		forge.seedPr(owner, repo, {
			number: 77,
			title: "Add the fix",
			headRef: "fix-branch",
			baseRef: "main",
			merged: true,
			createdAt: "2026-01-01T00:00:00Z",
			mergedAt: "2026-01-02T00:00:00Z",
		});

		const pr = await client.getPr(owner, repo, 77);
		expect(pr.number).toBe(77);
		expect(pr.headRef).toBe("fix-branch");
		expect(pr.merged).toBe(true);
		expect(pr.mergedAt).toBe("2026-01-02T00:00:00Z");
	});

	test("an unknown comment id fails with 404", async () => {
		await expect(client.getComment(owner, repo, 42, 4242)).rejects.toThrow(
			/404/,
		);
	});

	test("a wrong token fails with 401", async () => {
		const badClient = new GiteaClient({
			...forge.forgeConfig(owner, repo),
			token: "wrong-token",
		});
		await expect(badClient.comment(owner, repo, 42, "nope")).rejects.toThrow(
			/401/,
		);
	});
});
