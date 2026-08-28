import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { Orchestrator } from "../../src/core/orchestrator.ts";
import { Agent } from "../../src/agent/agent.ts";
import { OpenCodeHarness } from "../../src/harness/opencode.ts";
import { MemoryQueue } from "../../src/queue/memory.ts";
import { MentionParser } from "../../src/parser/mention.ts";
import { GiteaClient } from "../../src/forge/gitea.ts";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { MockTracker } from "../helpers/mock-tracker.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import { createStubOpenCode } from "../helpers/stub-opencode.ts";
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

// E2E test: the whole loop, with a real agent and a real harness.
// Real: StubGiteaServer (HTTP), GiteaClient, ForgeWebhookSource (HTTP),
//       MentionParser, Orchestrator, MemoryQueue, Agent,
//       OpenCodeHarness over a stub opencode binary
// Mock: IssueTracker
//
// Every other scenario claims and completes the task by hand. This one
// runs the agent polling loop, so the claim, the emoji reaction, the
// harness call and the report all happen the way they do in production.

describe("E2E: the agent runs the harness", () => {
	let forge: StubGiteaServer;
	let queue: MemoryQueue;
	let stub: ReturnType<typeof createStubOpenCode>;
	let stopWebhook: () => void;
	let stopWatching: () => void;
	let stopAgent: () => void;
	let mentionId: number;
	const webhookPort = 19977;

	beforeAll(() => {
		forge = new StubGiteaServer({ token: "token" });
		forge.start();
		stub = createStubOpenCode({ text: "Fixed the failing test" });

		queue = new MemoryQueue();
		const client = new GiteaClient(forge.forgeConfig(owner, repo));

		const orch = new Orchestrator({
			tracker: new MockTracker(),
			queue,
			forges: [{ name: "gitea", client }],
			parser: new MentionParser(agents),
			logger: silentLogger,
			agents,
		});

		const source = new ForgeWebhookSource(
			[{ ...forge.forgeConfig(owner, repo), name: "gitea" }],
			{ port: webhookPort, secret: "" },
		);
		stopWebhook = source.start((event) => {
			void orch.handleEvent(event);
		});
		stopWatching = orch.watchCompletions();

		const agent = new Agent({
			name: "code-agent",
			emoji: "+1",
			harness: new OpenCodeHarness({
				binary: stub.binary,
				model: "test/model",
			}),
			queue,
			forge: client,
			logger: silentLogger,
			model: "unused/fallback",
			pollIntervalMs: 20,
		});
		stopAgent = agent.start();

		// The agent reacts to the comment that mentioned it, so the
		// comment must exist on the forge.
		mentionId = forge.seedComment(owner, repo, 42, {
			author: "human",
			body: "@code-agent fix the failing test",
		}).id;
	});

	afterAll(() => {
		stopAgent();
		stopWatching();
		stopWebhook();
		forge.stop();
		stub.cleanup();
	});

	test("a mention reaches the harness and the answer reaches the forge", async () => {
		const res = await fetch(`http://localhost:${webhookPort}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "created",
				repository: { name: repo, owner: { login: owner } },
				issue: { number: 42, user: { login: "human" } },
				comment: {
					id: mentionId,
					body: "@code-agent fix the failing test",
					user: { login: "human" },
				},
			}),
		});
		expect(res.status).toBe(200);

		// The agent claimed the task and reacted with its emoji.
		await waitFor(() => forge.reactionsFor(mentionId).length === 1, {
			label: "emoji reaction on the mention",
		});
		expect(forge.reactionsFor(mentionId)[0]!.content).toBe("+1");

		// The harness ran, with the instruction and the model.
		await waitFor(() => stub.calls().length === 1, {
			label: "the harness call",
		});
		const call = stub.calls()[0]!;
		expect(call).toContain("run fix the failing test");
		expect(call).toContain("--format json");
		expect(call).toContain("--model test/model");

		// The agent reported, and the orchestrator answered on the forge.
		await waitFor(() => queue.done.length === 1, { label: "task done" });
		const summary = queue.done[0]!.result?.summary ?? "";
		expect(summary).toContain("done: Fixed the failing test");
		// The model the harness used, not the agent default.
		expect(summary).toContain("Model: test/model");

		await waitFor(() => forge.commentsFor(owner, repo, 42).length === 2, {
			label: "reply on the forge",
		});
		const reply = forge.commentsFor(owner, repo, 42)[1]!;
		expect(reply.body).toContain("code-agent");
		expect(reply.body).toContain("Fixed the failing test");
	});
});
