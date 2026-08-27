import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { MockForge } from "../helpers/mock-forge.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Logger } from "../../src/log/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const agents: AgentConfig[] = [
	{ name: "code-agent", emoji: "🔧", capabilities: ["code"] },
	{ name: "test-agent", emoji: "🧪", capabilities: ["testing"] },
];

// E2E test: full in-process system
// Real: ForgeWebhookSource (HTTP), MemoryQueue, MentionParser, Orchestrator
// Mock: ForgeClient, IssueTracker

describe("E2E: full system", () => {
	let webhookSource: ForgeWebhookSource;
	let orch: Orchestrator;
	let queue: MemoryQueue;
	let forge: MockForge;
	let tracker: MockTracker;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	const webhookPort = 19970;

	beforeAll(() => {
		tracker = new MockTracker();
		queue = new MemoryQueue();
		forge = new MockForge();
		const parser = new MentionParser(agents);

		orch = new Orchestrator({
			tracker,
			queue,
			forge,
			parser,
			logger: silentLogger,
			agents,
		});

		webhookSource = new ForgeWebhookSource(
			{
				type: "gitea",
				url: "https://git.example.com",
				token: "token",
				owner: "org",
				repo: "repo",
			},
			{ port: webhookPort, secret: "" },
		);

		stopWebhook = webhookSource.start((event) => {
			void orch.handleEvent(event);
		});
		stopWatching = orch.watchCompletions();
	});

	afterAll(() => {
		stopWatching();
		stopWebhook();
	});

	test("full lifecycle: webhook -> parse -> issue -> queue -> agent -> completion -> forge comment", async () => {
		// 1. Human posts a comment on the forge mentioning the agent
		const webhookPayload = {
			action: "created",
			repo: { name: "repo", owner: { name: "org" } },
			issue: {
				number: 42,
				title: "Fix bug",
				html_url: "https://git.example.com/org/repo/issues/42",
				user: { login: "human" },
			},
			comment: {
				id: 99,
				body: "@code-agent fix the failing test in PR #42",
				html_url: "https://git.example.com/org/repo/issues/42#comment-99",
				user: { login: "human" },
			},
		};

		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(webhookPayload),
		});
		expect(res.status).toBe(200);

		// Wait for async processing
		await new Promise((r) => setTimeout(r, 100));

		// 2. A beads issue was created
		expect(tracker.count).toBe(1);
		const issue = tracker.issues.values().next().value!;
		expect(issue.title).toContain("code-agent");
		expect(issue.status).toBe("open");

		// 3. A task was published to the queue
		expect(queue.pendingCount).toBe(1);

		// 4. Agent claims the task
		const claimed = await queue.claim("code-agent");
		expect(claimed).not.toBeNull();
		expect(claimed!.agent).toBe("code-agent");
		expect(claimed!.followUpAfter).toBe(42);
		expect(queue.pendingCount).toBe(0);
		expect(queue.activeCount).toBe(1);

		// 5. Agent does the work and completes
		await queue.complete(claimed!.id, {
			status: "success",
			summary: "Fixed the failing test by adding the missing mock",
		});

		// Wait for the completion watcher
		await new Promise((r) => setTimeout(r, 100));

		// 6. The forge received a completion comment
		expect(forge.comments.length).toBeGreaterThanOrEqual(1);
		const lastComment = forge.comments[forge.comments.length - 1];
		expect(lastComment.number).toBe(42);
		expect(lastComment.body).toContain("code-agent");
		expect(lastComment.body).toContain("Fixed the failing test");

		// 7. The beads issue was closed
		expect(issue.status).toBe("closed");
	});

	test("self-write filter: agent comment does not create a new task", async () => {
		const countBefore = tracker.count;

		// Simulate the agent's completion comment coming back as a webhook
		const webhookPayload = {
			action: "created",
			repo: { name: "repo", owner: { name: "org" } },
			issue: {
				number: 42,
				title: "Fix bug",
				html_url: "https://git.example.com/org/repo/issues/42",
				user: { login: "code-agent" }, // authored by our agent
			},
			comment: {
				id: 100,
				body: "🔧 **code-agent** completed: Fixed the failing test",
				html_url: "https://git.example.com/org/repo/issues/42#comment-100",
				user: { login: "code-agent" },
			},
		};

		await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(webhookPayload),
		});

		await new Promise((r) => setTimeout(r, 100));

		// No new issue should have been created
		expect(tracker.count).toBe(countBefore);
	});

	test("multiple agents can be assigned from one comment", async () => {
		const countBefore = tracker.count;

		const webhookPayload = {
			action: "created",
			repo: { name: "repo", owner: { name: "org" } },
			issue: {
				number: 43,
				title: "Feature X",
				html_url: "https://git.example.com/org/repo/issues/43",
				user: { login: "human" },
			},
			comment: {
				id: 101,
				body: "@code-agent implement the feature, then @test-agent write the tests",
				html_url: "https://git.example.com/org/repo/issues/43#comment-101",
				user: { login: "human" },
			},
		};

		await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(webhookPayload),
		});

		await new Promise((r) => setTimeout(r, 100));

		// Two issues created (one per agent)
		expect(tracker.count).toBe(countBefore + 2);
		expect(queue.pendingCount).toBe(2);
	});

	test("non-comment webhook is ignored by the parser", async () => {
		const countBefore = tracker.count;

		const webhookPayload = {
			action: "opened",
			repo: { name: "repo", owner: { name: "org" } },
			pull_request: {
				number: 50,
				title: "Some PR",
				html_url: "https://git.example.com/org/repo/pull/50",
				user: { login: "human" },
			},
		};

		await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(webhookPayload),
		});

		await new Promise((r) => setTimeout(r, 100));

		// No new issues (PR events don't trigger the mention parser)
		expect(tracker.count).toBe(countBefore);
	});

	test("invalid JSON returns 400", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not valid json",
		});
		expect(res.status).toBe(400);
	});

	test("GET request returns 404", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`);
		expect(res.status).toBe(404);
	});
});