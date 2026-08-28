import { describe, expect, test } from "bun:test";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import type { ForgeConfig } from "../../src/config/types.ts";
import type { Event, CommentPayload, PrPayload } from "../../src/core/event.ts";

const forgeConfig: ForgeConfig = {
	name: "test",
	type: "gitea",
	url: "https://git.example.com",
	token: "token",
	owner: "org",
	repo: "repo",
};

// We test the webhook parsing by sending HTTP requests to the source.
// Since the source uses Bun.serve, we test via HTTP.

describe("ForgeWebhookSource", () => {
	test("parses a Gitea issue_comment webhook with the repository key", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19996,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		// The shape Gitea sends: a "repository" key, and an owner that
		// carries "username" and "login" but no "name".
		const payload = {
			action: "created",
			repository: {
				name: "repo",
				full_name: "org/repo",
				owner: { login: "org", username: "org" },
			},
			issue: {
				number: 7,
				title: "Test issue",
				html_url: "https://git.example.com/org/repo/issues/7",
				user: { login: "human" },
			},
			comment: {
				id: 21,
				body: "@code-agent fix it",
				html_url: "https://git.example.com/org/repo/issues/7#issuecomment-21",
				user: { login: "human" },
			},
		};

		await fetch("http://localhost:19996/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		const cp = events[0].payload as CommentPayload;
		expect(cp.owner).toBe("org");
		expect(cp.repo).toBe("repo");
		expect(cp.number).toBe(7);
		expect(cp.body).toBe("@code-agent fix it");
	});

	test("parses a GitHub issue_comment webhook with the repository key", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19997,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		// The shape GitHub sends: a "repository" key, and an owner that
		// carries "login" only.
		const payload = {
			action: "created",
			repository: {
				name: "repo",
				full_name: "org/repo",
				owner: { login: "org" },
			},
			issue: {
				number: 9,
				title: "Test issue",
				html_url: "https://github.com/org/repo/issues/9",
				user: { login: "human" },
			},
			comment: {
				id: 33,
				body: "@code-agent fix it",
				html_url: "https://github.com/org/repo/issues/9#issuecomment-33",
				user: { login: "human" },
			},
		};

		await fetch("http://localhost:19997/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		const cp = events[0].payload as CommentPayload;
		expect(cp.owner).toBe("org");
		expect(cp.repo).toBe("repo");
		expect(cp.number).toBe(9);
		expect(cp.author).toBe("human");
	});

	test("parses a Gitea issue_comment webhook", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19993,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		const payload = {
			action: "created",
			repo: {
				name: "repo",
				owner: { name: "org" },
			},
			issue: {
				number: 42,
				title: "Test issue",
				html_url: "https://git.example.com/org/repo/issues/42",
				user: { login: "human" },
			},
			comment: {
				id: 99,
				body: "@code-agent fix the bug",
				html_url: "https://git.example.com/org/repo/issues/42#comment-99",
				user: { login: "human" },
			},
		};

		await fetch("http://localhost:19993/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("comment");
		const cp = events[0].payload as CommentPayload;
		expect(cp.owner).toBe("org");
		expect(cp.repo).toBe("repo");
		expect(cp.number).toBe(42);
		expect(cp.commentId).toBe(99);
		expect(cp.author).toBe("human");
		expect(cp.body).toBe("@code-agent fix the bug");
	});

	test("parses a GitHub pull_request webhook (opened)", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19994,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		const payload = {
			action: "opened",
			repo: {
				name: "repo",
				owner: { login: "org" },
			},
			pull_request: {
				number: 10,
				title: "Add feature",
				html_url: "https://github.com/org/repo/pull/10",
				user: { login: "dev" },
			},
		};

		await fetch("http://localhost:19994/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("pr");
		const pp = events[0].payload as PrPayload;
		expect(pp.number).toBe(10);
		expect(pp.title).toBe("Add feature");
		expect(pp.action).toBe("opened");
		expect(pp.author).toBe("dev");
	});

	test("parses a GitHub pull_request webhook (merged)", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19995,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		const payload = {
			action: "closed",
			repo: {
				name: "repo",
				owner: { login: "org" },
			},
			pull_request: {
				number: 10,
				title: "Add feature",
				html_url: "https://github.com/org/repo/pull/10",
				user: { login: "dev" },
				merged: true,
			},
		};

		await fetch("http://localhost:19995/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("pr");
		const pp = events[0].payload as PrPayload;
		expect(pp.action).toBe("merged");
	});

	test("parses a GitHub pull_request webhook (closed, not merged)", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19995,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		const payload = {
			action: "closed",
			repo: {
				name: "repo",
				owner: { login: "org" },
			},
			pull_request: {
				number: 11,
				title: "Abandoned PR",
				html_url: "https://github.com/org/repo/pull/11",
				user: { login: "dev" },
				merged: false,
			},
		};

		await fetch("http://localhost:19995/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		await new Promise((r) => setTimeout(r, 100));
		stop();

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("pr");
		const pp = events[0].payload as PrPayload;
		expect(pp.action).toBe("closed");
	});

	test("rejects requests with invalid signature", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19996,
			secret: "my-secret",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		const res = await fetch("http://localhost:19996/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "created" }),
		});

		expect(res.status).toBe(401);
		expect(events).toHaveLength(0);
		stop();
	});

	test("rejects non-POST requests", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19997,
			secret: "",
		});

		const stop = source.start(() => {});
		const res = await fetch("http://localhost:19997/", {
			method: "GET",
		});
		expect(res.status).toBe(404);
		stop();
	});

	test("returns 400 for invalid JSON", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19998,
			secret: "",
		});

		const stop = source.start(() => {});
		const res = await fetch("http://localhost:19998/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(400);
		stop();
	});

	test("ignores unrecognized webhook types", async () => {
		const source = new ForgeWebhookSource(forgeConfig, {
			port: 19999,
			secret: "",
		});

		const events: Event[] = [];
		const stop = source.start((e) => events.push(e));

		await fetch("http://localhost:19999/", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "some_random_event",
				repo: { name: "repo", owner: { name: "org" } },
			}),
		});

		await new Promise((r) => setTimeout(r, 100));
		expect(events).toHaveLength(0);
		stop();
	});
});