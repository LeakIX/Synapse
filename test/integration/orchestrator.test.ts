import { describe, expect, test } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { MockForge } from "../helpers/mock-forge.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import type { Event, CommentPayload } from "../../src/core/event.ts";
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

function makeCommentEvent(
	body: string,
	author: string = "human",
): Event {
	return {
		id: "test-event",
		source: "forge-webhook",
		kind: "comment",
		payload: {
			owner: "org",
			repo: "repo",
			number: 42,
			commentId: 99,
			author,
			body,
			url: "https://git.example.com/org/repo/issues/42#comment-99",
		} satisfies CommentPayload,
		receivedAt: new Date().toISOString(),
	};
}

function makeOrchestrator() {
	const tracker = new MockTracker();
	const queue = new MemoryQueue();
	const forge = new MockForge();
	const parser = new MentionParser(agents);
	const orch = new Orchestrator({
		tracker,
		queue,
		forges: [{ name: "test", client: forge }],
		parser,
		logger: silentLogger,
		agents,
	});
	const stop = orch.watchCompletions();
	return { orch, tracker, queue, forge, stop };
}

describe("Orchestrator (integration)", () => {
	test("full flow: comment -> issue -> queue -> completion -> forge comment", async () => {
		const { orch, tracker, queue, forge } = makeOrchestrator();

		const event = makeCommentEvent(
			"@code-agent fix the failing test in PR #42",
		);
		const tasks = await orch.handleEvent(event);

		expect(tracker.count).toBe(1);
		const issue = tracker.issues.values().next().value!;
		expect(issue.title).toContain("code-agent");
		expect(issue.labels).toContain("code-agent");

		expect(tasks).toHaveLength(1);
		expect(queue.pendingCount).toBe(1);
		expect(tasks[0].agent).toBe("code-agent");
		expect(tasks[0].followUpAfter).toBe(42);

		const claimed = await queue.claim("code-agent");
		expect(claimed).not.toBeNull();
		expect(queue.pendingCount).toBe(0);
		expect(queue.activeCount).toBe(1);

		await queue.complete(claimed!.id, {
			status: "success",
			summary: "fixed the test",
		});

		await new Promise((r) => setTimeout(r, 50));

		expect(forge.comments).toHaveLength(1);
		expect(forge.comments[0].number).toBe(42);
		expect(forge.comments[0].body).toContain("code-agent");
		expect(forge.comments[0].body).toContain("fixed the test");

		expect(issue.status).toBe("closed");
	});

	test("self-write filter: agent comments are ignored", async () => {
		const { orch, tracker } = makeOrchestrator();

		const event = makeCommentEvent(
			"@test-agent run the tests",
			"code-agent",
		);
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(0);
		expect(tracker.count).toBe(0);
	});

	test("no mention: no task created", async () => {
		const { orch, tracker, queue } = makeOrchestrator();

		const event = makeCommentEvent(
			"just a regular comment, no mentions",
		);
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(0);
		expect(tracker.count).toBe(0);
		expect(queue.pendingCount).toBe(0);
	});

	test("multiple mentions: multiple tasks created", async () => {
		const { orch, tracker, queue } = makeOrchestrator();

		const event = makeCommentEvent(
			"@code-agent fix the bug, then @test-agent add regression tests",
		);
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(2);
		expect(tracker.count).toBe(2);
		expect(queue.pendingCount).toBe(2);
		expect(tasks[0].agent).toBe("code-agent");
		expect(tasks[1].agent).toBe("test-agent");
	});

	test("task failure: forge gets a failure comment", async () => {
		const { orch, tracker, queue, forge } = makeOrchestrator();

		const event = makeCommentEvent("@code-agent fix the bug");
		const tasks = await orch.handleEvent(event);
		expect(tasks).toHaveLength(1);

		const claimed = await queue.claim("code-agent");
		expect(claimed).not.toBeNull();

		await queue.fail(claimed!.id, {
			status: "failure",
			summary: "could not find the bug",
		});

		await new Promise((r) => setTimeout(r, 50));

		expect(forge.comments).toHaveLength(1);
		expect(forge.comments[0].body).toContain("failed");
		expect(forge.comments[0].body).toContain("could not find the bug");

		const issue = tracker.issues.values().next().value!;
		expect(issue.status).toBe("blocked");
	});

	test("unknown agent: no task created", async () => {
		const { orch, tracker } = makeOrchestrator();

		const event = makeCommentEvent("@unknown-agent do something");
		const tasks = await orch.handleEvent(event);
		expect(tasks).toHaveLength(0);
		expect(tracker.count).toBe(0);
	});

	test("non-comment event: no tasks", async () => {
		const { orch, tracker } = makeOrchestrator();

		const event: Event = {
			id: "e1",
			source: "forge-webhook",
			kind: "pr",
			payload: {
				owner: "org",
				repo: "repo",
				number: 10,
				title: "Some PR",
				author: "human",
				action: "opened",
				url: "https://git.example.com/org/repo/pull/10",
			},
			receivedAt: new Date().toISOString(),
		};

		const tasks = await orch.handleEvent(event);
		expect(tasks).toHaveLength(0);
		expect(tracker.count).toBe(0);
	});

	test("watchCompletions returns a stop function", async () => {
		const tracker = new MockTracker();
		const queue = new MemoryQueue();
		const forge = new MockForge();
		const parser = new MentionParser(agents);
		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "test", client: forge }],
			parser,
			logger: silentLogger,
			agents,
		});

		const stop = orch.watchCompletions();
		expect(typeof stop).toBe("function");

		const event = makeCommentEvent("@code-agent do something");
		await orch.handleEvent(event);
		const claimed = await queue.claim("code-agent");
		await queue.complete(claimed!.id, {
			status: "success",
			summary: "done",
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(forge.comments).toHaveLength(1);

		stop();

		const event2 = makeCommentEvent("@code-agent do something else");
		await orch.handleEvent(event2);
		const claimed2 = await queue.claim("code-agent");
		await queue.complete(claimed2!.id, {
			status: "success",
			summary: "done again",
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(forge.comments).toHaveLength(1);
	});

	test("forge context is set for comment events", async () => {
		const { orch, queue, forge } = makeOrchestrator();

		const event = makeCommentEvent("@code-agent fix it");
		const tasks = await orch.handleEvent(event);

		expect(tasks[0].forgeContext).toBeDefined();
		expect(tasks[0].forgeContext!.owner).toBe("org");
		expect(tasks[0].forgeContext!.repo).toBe("repo");
		expect(tasks[0].forgeContext!.number).toBe(42);
		expect(tasks[0].forgeContext!.commentId).toBe(99);

		const claimed = await queue.claim("code-agent");
		await queue.complete(claimed!.id, {
			status: "success",
			summary: "fixed",
		});
		await new Promise((r) => setTimeout(r, 50));

		expect(forge.comments[0].owner).toBe("org");
		expect(forge.comments[0].repo).toBe("repo");
		expect(forge.comments[0].number).toBe(42);
	});

	test("urgency is propagated from parser to task", async () => {
		const { orch } = makeOrchestrator();

		const event = makeCommentEvent("@code-agent fix this now");
		const tasks = await orch.handleEvent(event);
		expect(tasks[0].urgency).toBe("now");
	});

	test("followUpAfter is propagated from parser to task", async () => {
		const { orch } = makeOrchestrator();

		const event = makeCommentEvent("@code-agent review PR #123");
		const tasks = await orch.handleEvent(event);
		expect(tasks[0].followUpAfter).toBe(123);
	});
});