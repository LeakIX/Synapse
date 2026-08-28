import { describe, expect, test, beforeEach } from "bun:test";
import { Agent } from "../../src/agent/agent.ts";
import { CommandHarness } from "../../src/harness/command.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import type { QueueTask } from "../../src/queue/types.ts";
import type { ForgeClient, ForgeComment, ForgePr } from "../../src/forge/types.ts";
import type { Logger } from "../../src/log/types.ts";
import type { AgentHarness, HarnessResult, HarnessTask } from "../../src/harness/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

class MockForge implements ForgeClient {
	reactions: Array<{ commentId: number; emoji: string }> = [];
	comments: Array<{ number: number; body: string }> = [];

	async comment(
		_o: string,
		_r: string,
		number: number,
		body: string,
	): Promise<void> {
		this.comments.push({ number, body });
	}

	async react(
		_o: string,
		_r: string,
		_n: number,
		commentId: number,
		emoji: string,
	): Promise<void> {
		this.reactions.push({ commentId, emoji });
	}

	async getComment(
		_o: string,
		_r: string,
		_n: number,
		commentId: number,
	): Promise<ForgeComment> {
		return { id: commentId, author: "test", body: "", createdAt: "" };
	}

	async getPr(
		_o: string,
		_r: string,
		number: number,
	): Promise<ForgePr> {
		return {
			number,
			title: "test",
			headRef: "main",
			baseRef: "develop",
			merged: false,
			createdAt: "",
			url: "",
		};
	}

	async listComments(
		_o: string,
		_r: string,
		_n: number,
	): Promise<ForgeComment[]> {
		return [];
	}
}

class StaticHarness implements AgentHarness {
	readonly name = "command" as const;
	#result: HarnessResult;

	constructor(result: HarnessResult) {
		this.#result = result;
	}

	async run(_task: HarnessTask): Promise<HarnessResult> {
		return this.#result;
	}
}

function makeTask(overrides: Partial<QueueTask> = {}): QueueTask {
	return {
		id: Math.random().toString(36).slice(2),
		issueId: "test-abc.1",
		agent: "code-agent",
		instruction: "fix the bug",
		urgency: "queued",
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("Agent", () => {
	let queue: MemoryQueue;
	let forge: MockForge;

	beforeEach(() => {
		queue = new MemoryQueue();
		forge = new MockForge();
	});

	test("claims a task matching its name", async () => {
		const task = makeTask({ agent: "code-agent" });
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo" }),
			queue,
			forge,
			logger: silentLogger,
			model: "test/model",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		// The agent should have claimed and completed the task
		expect(queue.done).toHaveLength(1);
		expect(queue.done[0].id).toBe(task.id);
	});

	test("does not claim a task for a different agent", async () => {
		const task = makeTask({ agent: "other-agent" });
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo" }),
			queue,
			forge,
			logger: silentLogger,
			model: "test/model",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(queue.done).toHaveLength(0);
	});

	test("reacts with emoji on the forge comment", async () => {
		const task = makeTask({
			forgeContext: {
				owner: "org",
				repo: "repo",
				number: 42,
				commentId: 99,
				url: "http://forge/org/repo/issues/42",
			},
		});
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo done" }),
			queue,
			forge,
			logger: silentLogger,
			model: "test/model",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(forge.reactions).toHaveLength(1);
		expect(forge.reactions[0].emoji).toBe("🔧");
		expect(forge.reactions[0].commentId).toBe(99);
	});

	test("records the model in the result summary", async () => {
		const task = makeTask();
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo hello" }),
			queue,
			forge,
			logger: silentLogger,
			model: "ollama/llama3",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(queue.done).toHaveLength(1);
		expect(queue.done[0].result?.summary).toContain("Model: ollama/llama3");
	});

	test("records the model URL in the result summary", async () => {
		const task = makeTask();
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo hello" }),
			queue,
			forge,
			logger: silentLogger,
			model: "ollama/llama3",
			modelUrl: "http://127.0.0.1:11434",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(queue.done).toHaveLength(1);
		expect(queue.done[0].result?.summary).toContain(
			"Model URL: http://127.0.0.1:11434",
		);
	});

	test("records all models when the harness returns a model fleet", async () => {
		const task = makeTask();
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new StaticHarness({
				status: "success",
				summary: "done: fleet",
				models: [
					{ model: "openai/gpt-5", url: "https://api.openai.com/v1" },
					{ model: "anthropic/claude-opus-4.6", url: "https://api.anthropic.com" },
				],
			}),
			queue,
			forge,
			logger: silentLogger,
			model: "fallback/model",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(queue.done).toHaveLength(1);
		const summary = queue.done[0].result?.summary ?? "";
		expect(summary).toContain("Model: openai/gpt-5");
		expect(summary).toContain("Model URL: https://api.openai.com/v1");
		expect(summary).toContain("Model: anthropic/claude-opus-4.6");
		expect(summary).toContain("Model URL: https://api.anthropic.com");
	});

	test("marks task as failed when command exits non-zero", async () => {
		const task = makeTask();
		await queue.publish(task);

		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "false" }),
			queue,
			forge,
			logger: silentLogger,
			model: "test/model",
			pollIntervalMs: 100,
		});

		const stop = agent.start();
		await new Promise((r) => setTimeout(r, 500));
		stop();

		expect(queue.failed).toHaveLength(1);
		expect(queue.failed[0].result?.status).toBe("failure");
		expect(queue.failed[0].result?.summary).toContain("Model: test/model");
	});

	test("setPollInterval changes the interval", async () => {
		const agent = new Agent({
			name: "code-agent",
			emoji: "🔧",
			harness: new CommandHarness({ command: "echo" }),
			queue,
			forge,
			logger: silentLogger,
			model: "test/model",
			pollIntervalMs: 5000,
		});

		agent.setPollInterval(100);
		// Just verify it does not throw
		const stop = agent.start();
		stop();
	});
});