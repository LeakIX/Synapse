import { describe, expect, test } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { CiGate } from "../../src/core/ci-gate.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { MockForge } from "../helpers/mock-forge.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import type { AgentConfig } from "../../src/config/types.ts";
import type { Event, CommentPayload } from "../../src/core/event.ts";
import type { CiClient, CiBuild, CiStatus } from "../../src/ci/types.ts";
import type { Logger } from "../../src/log/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

const agents: AgentConfig[] = [
	{ name: "code-agent", emoji: "🔧" },
];

class MockCi implements CiClient {
	status: CiStatus;
	constructor(status: CiStatus = "passing") {
		this.status = status;
	}
	async isMerged(): Promise<boolean> {
		return this.status === "passing";
	}
	async getBuild(_o: string, _r: string, pr: number): Promise<CiBuild> {
		return {
			prNumber: pr,
			status: this.status,
			url: "http://ci",
			startedAt: new Date().toISOString(),
		};
	}
}

function makeCommentEvent(body: string): Event {
	return {
		id: "test-event",
		source: "forge-webhook",
		kind: "comment",
		payload: {
			owner: "org",
			repo: "repo",
			number: 42,
			commentId: 99,
			author: "human",
			body,
			url: "https://git.example.com/org/repo/issues/42#comment-99",
		} satisfies CommentPayload,
		receivedAt: new Date().toISOString(),
	};
}

describe("Orchestrator + CiGate (integration)", () => {
	test("follow-up task is held when CI is failing", async () => {
		const ci = new MockCi("failing");
		const gate = new CiGate(ci, silentLogger, "org", "repo");
		const tracker = new MockTracker();
		const queue = new MemoryQueue();
		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "test", client: new MockForge() }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
			ciGate: gate,
		});

		const event = makeCommentEvent(
			"@code-agent review the changes in PR #42",
		);
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(1);
		expect(queue.pendingCount).toBe(0);
		expect(tracker.count).toBe(1);

		const issue = tracker.issues.values().next().value!;
		expect(issue.status).toBe("blocked");
	});

	test("follow-up task is published when CI is passing", async () => {
		const ci = new MockCi("passing");
		const gate = new CiGate(ci, silentLogger, "org", "repo");
		const tracker = new MockTracker();
		const queue = new MemoryQueue();
		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "test", client: new MockForge() }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
			ciGate: gate,
		});

		const event = makeCommentEvent(
			"@code-agent review the changes in PR #42",
		);
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(1);
		expect(queue.pendingCount).toBe(1);
		expect(tracker.count).toBe(1);

		const issue = tracker.issues.values().next().value!;
		expect(issue.status).toBe("open");
	});

	test("non-follow-up task is always published regardless of CI", async () => {
		const ci = new MockCi("failing");
		const gate = new CiGate(ci, silentLogger, "org", "repo");
		const tracker = new MockTracker();
		const queue = new MemoryQueue();
		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "test", client: new MockForge() }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
			ciGate: gate,
		});

		const event = makeCommentEvent("@code-agent fix the bug");
		const tasks = await orch.handleEvent(event);

		expect(tasks).toHaveLength(1);
		expect(queue.pendingCount).toBe(1);
	});

	test("CI transitions from failing to passing: task can be dispatched", async () => {
		const ci = new MockCi("failing");
		const gate = new CiGate(ci, silentLogger, "org", "repo");
		const tracker = new MockTracker();
		const queue = new MemoryQueue();
		const orch = new Orchestrator({
			tracker,
			queue,
			forges: [{ name: "test", client: new MockForge() }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
			ciGate: gate,
		});

		const event = makeCommentEvent("@code-agent review PR #42");
		await orch.handleEvent(event);
		expect(queue.pendingCount).toBe(0);

		ci.status = "passing";
		const event2 = makeCommentEvent("@code-agent review PR #42 again");
		const tasks = await orch.handleEvent(event2);
		expect(tasks).toHaveLength(1);
		expect(queue.pendingCount).toBe(1);
	});
});