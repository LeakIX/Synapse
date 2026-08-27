import { describe, expect, test } from "bun:test";
import { MentionParser } from "../../src/parser/mention.ts";
import type { Event, CommentPayload } from "../../src/core/event.ts";
import type { AgentConfig } from "../../src/config/types.ts";

const agents: AgentConfig[] = [
	{ name: "code-agent", emoji: "🔧" },
	{ name: "test-agent", emoji: "🧪" },
];

const parser = new MentionParser(agents);

function commentEvent(body: string): Event {
	return {
		id: "test-event",
		source: "test",
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

describe("MentionParser", () => {
	test("extracts a simple mention", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent fix the failing tests"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].agentName).toBe("code-agent");
		expect(results[0].instruction).toBe("fix the failing tests");
		expect(results[0].urgency).toBe("queued");
		expect(results[0].followUpAfter).toBeUndefined();
	});

	test("extracts mention with 'now' keyword", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent fix this now"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].urgency).toBe("now");
	});

	test("extracts PR number as followUpAfter", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent review the changes in PR #123"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].followUpAfter).toBe(123);
	});

	test("extracts multiple mentions", async () => {
		const results = await parser.parse(
			commentEvent(
				"@code-agent fix the bug, then @test-agent add tests for it",
			),
		);
		expect(results).toHaveLength(2);
		expect(results[0].agentName).toBe("code-agent");
		expect(results[1].agentName).toBe("test-agent");
	});

	test("returns empty for no mentions", async () => {
		const results = await parser.parse(
			commentEvent("just a regular comment with no agent mentions"),
		);
		expect(results).toHaveLength(0);
	});

	test("returns empty for non-comment events", async () => {
		const event: Event = {
			id: "e1",
			source: "test",
			kind: "issue",
			payload: {
				owner: "org",
				repo: "repo",
				number: 1,
				title: "test",
				author: "human",
				action: "opened",
				url: "https://git.example.com/org/repo/issues/1",
			},
			receivedAt: new Date().toISOString(),
		};
		const results = await parser.parse(event);
		expect(results).toHaveLength(0);
	});

	test("ignores unknown agent mentions", async () => {
		const results = await parser.parse(
			commentEvent("@unknown-agent do something"),
		);
		expect(results).toHaveLength(0);
	});

	test("handles mention at start of body", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent please fix the flaky test in CI"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].instruction).toBe("please fix the flaky test in CI");
	});

	test("handles mention in middle of body", async () => {
		const results = await parser.parse(
			commentEvent("Hey @code-agent can you look at this?"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].instruction).toBe("can you look at this?");
	});

	test("handles multiple PR numbers, takes first", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent fix #10 and #20"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].followUpAfter).toBe(10);
	});

	test("now keyword in the middle of instruction", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent this is urgent, do it now please"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].urgency).toBe("now");
	});

	test("now as substring of another word does not trigger", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent know the answer"),
		);
		expect(results).toHaveLength(1);
		expect(results[0].urgency).toBe("queued");
	});

	test("empty instruction after mention returns no result", async () => {
		const results = await parser.parse(commentEvent("@code-agent"));
		expect(results).toHaveLength(0);
	});

	test("mention with trailing punctuation", async () => {
		const results = await parser.parse(
			commentEvent("@code-agent. Fix the bug"),
		);
		// The mention "@code-agent" matches, but the instruction starts with ". Fix the bug"
		// After trim, it's ". Fix the bug" which is non-empty, so it should be included
		expect(results).toHaveLength(1);
		expect(results[0].instruction).toBe(". Fix the bug");
	});
});