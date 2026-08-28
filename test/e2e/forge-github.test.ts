import { describe, expect, test, beforeAll, beforeEach, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GitHubClient } from "../../src/forge/github.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubGitHubServer } from "../helpers/stub-forge-server.ts";
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
const token = "gh-token";

// E2E test: the same round trip against the GitHub dialect.
// Real: StubGitHubServer (HTTP), GitHubClient, ForgeWebhookSource (HTTP),
//       MentionParser, Orchestrator, MemoryQueue
// Mock: IssueTracker
//
// GitHub differs from Gitea in three ways this file pins: the API sits
// at the root instead of under /api/<version>, the token rides as a
// Bearer token, and the client maps an emoji to a reaction name.

describe("E2E: GitHub forge round trip", () => {
	let forge: StubGitHubServer;
	let client: GitHubClient;
	let queue: MemoryQueue;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	const webhookPort = 19973;

	/** Drive one task from the mention to the reply on the forge. */
	async function roundTrip(number: number, commentId: number): Promise<void> {
		const before = queue.pendingCount;
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: {
					number,
					title: "Some issue",
					html_url: `${forge.url}/${owner}/${repo}/issues/${number}`,
					user: { login: "human" },
				},
				comment: {
					id: commentId,
					body: "@code-agent fix the failing test",
					html_url: `${forge.url}/${owner}/${repo}/issues/${number}`,
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);
		await waitFor(() => queue.pendingCount > before, {
			label: "task published",
		});

		const task = await queue.claim("code-agent");
		expect(task).not.toBeNull();
		await queue.complete(task!.id, {
			status: "success",
			summary: "Fixed the failing test",
		});
		await waitFor(() => forge.commentsFor(owner, repo, number).length === 1, {
			label: `reply on issue ${number}`,
		});
	}

	beforeAll(() => {
		forge = new StubGitHubServer({ token });
		forge.start();

		queue = new MemoryQueue();
		client = new GitHubClient(forge.forgeConfig(owner, repo));

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
		await roundTrip(42, 700);

		const posted = forge.commentsFor(owner, repo, 42)[0]!;
		expect(posted.body).toContain("code-agent");
		expect(posted.body).toContain("Fixed the failing test");
	});

	test("the routes sit at the root and the token rides as a bearer", async () => {
		await roundTrip(45, 701);

		const post = forge.requests.find(
			(r) =>
				r.method === "POST" &&
				r.path === `/repos/${owner}/${repo}/issues/45/comments`,
		);
		expect(post).toBeDefined();
		expect(post!.authorization).toBe(`Bearer ${token}`);
	});

	test("the client maps the agent emoji to a reaction name", async () => {
		const seeded = forge.seedComment(owner, repo, 44, {
			author: "human",
			body: "@code-agent take a look",
		});

		await client.react(owner, repo, 44, seeded.id, "+1");

		expect(forge.reactionsFor(seeded.id)).toEqual([
			{ commentId: seeded.id, content: "rocket" },
		]);
	});

	test("a seeded pull request reads back through the API", async () => {
		forge.seedPr(owner, repo, {
			number: 88,
			title: "Add the fix",
			headRef: "fix-branch",
			baseRef: "main",
			merged: false,
			createdAt: "2026-01-01T00:00:00Z",
		});

		const pr = await client.getPr(owner, repo, 88);
		expect(pr.number).toBe(88);
		expect(pr.headRef).toBe("fix-branch");
		expect(pr.merged).toBe(false);
		expect(pr.mergedAt).toBeUndefined();
	});

	test("a wrong token fails with 401", async () => {
		const badClient = new GitHubClient({
			...forge.forgeConfig(owner, repo),
			token: "wrong-token",
		});
		await expect(badClient.comment(owner, repo, 42, "nope")).rejects.toThrow(
			/401/,
		);
	});
});
