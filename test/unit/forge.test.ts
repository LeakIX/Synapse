import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { GiteaClient } from "../../src/forge/gitea.ts";
import type { ForgeConfig } from "../../src/config/types.ts";

// Mock Gitea API server
let server: ReturnType<typeof Bun.serve>;
const port = 19991;

function giteaConfig(): ForgeConfig {
	return {
		type: "gitea",
		url: `http://localhost:${port}`,
		token: "test-token",
		owner: "testorg",
		repo: "testrepo",
	};
}

beforeAll(() => {
	server = Bun.serve({
		port,
		async fetch(req: Request) {
			const url = new URL(req.url);
			const method = req.method;

			// Comments
			if (
				method === "POST" &&
				url.pathname === "/api/v1/repos/testorg/testrepo/issues/42/comments"
			) {
				return Response.json({ id: 99, body: "test comment" });
			}
			if (
				method === "GET" &&
				url.pathname ===
					"/api/v1/repos/testorg/testrepo/issues/comments/99"
			) {
				return Response.json({
					id: 99,
					user: { login: "testuser" },
					body: "test comment body",
					created_at: "2026-01-01T00:00:00Z",
					updated_at: "2026-01-02T00:00:00Z",
				});
			}
			if (
				method === "GET" &&
				url.pathname ===
					"/api/v1/repos/testorg/testrepo/issues/42/comments"
			) {
				return Response.json([
					{
						id: 99,
						user: { login: "testuser" },
						body: "comment 1",
						created_at: "2026-01-01T00:00:00Z",
					},
					{
						id: 100,
						user: { login: "other" },
						body: "comment 2",
						created_at: "2026-01-02T00:00:00Z",
					},
				]);
			}
			// Reactions
			if (
				method === "POST" &&
				url.pathname ===
					"/api/v1/repos/testorg/testrepo/issues/comments/99/reactions"
			) {
				return Response.json({ content: "rocket" });
			}
			// PR
			if (
				method === "GET" &&
				url.pathname === "/api/v1/repos/testorg/testrepo/pulls/42"
			) {
				return Response.json({
					number: 42,
					title: "Test PR",
					head: { ref: "feature-branch" },
					base: { ref: "main" },
					merged: true,
					created_at: "2026-01-01T00:00:00Z",
					merged_at: "2026-01-02T00:00:00Z",
					html_url: "https://git.example.com/testorg/testrepo/pulls/42",
				});
			}
			// Error case
			if (url.pathname.includes("/error")) {
				return new Response("not found", { status: 404 });
			}

			return new Response("not found", { status: 404 });
		},
	});
});

afterAll(() => {
	server.stop();
});

describe("GiteaClient", () => {
	const client = new GiteaClient(giteaConfig());

	test("comment posts to the API", async () => {
		await client.comment("testorg", "testrepo", 42, "hello");
		// no throw = success
	});

	test("react posts a reaction", async () => {
		await client.react("testorg", "testrepo", 42, 99, "🚀");
	});

	test("getComment returns a ForgeComment", async () => {
		const c = await client.getComment("testorg", "testrepo", 42, 99);
		expect(c.id).toBe(99);
		expect(c.author).toBe("testuser");
		expect(c.body).toBe("test comment body");
		expect(c.createdAt).toBe("2026-01-01T00:00:00Z");
		expect(c.updatedAt).toBe("2026-01-02T00:00:00Z");
	});

	test("getPr returns a ForgePr", async () => {
		const pr = await client.getPr("testorg", "testrepo", 42);
		expect(pr.number).toBe(42);
		expect(pr.title).toBe("Test PR");
		expect(pr.headRef).toBe("feature-branch");
		expect(pr.baseRef).toBe("main");
		expect(pr.merged).toBe(true);
		expect(pr.mergedAt).toBe("2026-01-02T00:00:00Z");
	});

	test("listComments returns all comments", async () => {
		const comments = await client.listComments("testorg", "testrepo", 42);
		expect(comments).toHaveLength(2);
		expect(comments[0].author).toBe("testuser");
		expect(comments[1].author).toBe("other");
	});

	test("throws on API error", async () => {
		const badClient = new GiteaClient({
			...giteaConfig(),
			url: `http://localhost:${port}`,
		});
		await expect(
			badClient.comment("testorg", "testrepo", 999, "test"),
		).rejects.toThrow(/404/);
	});

	test("sends auth header", async () => {
		let receivedAuth = "";
		const authServer = Bun.serve({
			port: 19992,
			async fetch(req: Request) {
				receivedAuth = req.headers.get("authorization") ?? "";
				return Response.json({ id: 1 });
			},
		});
		const authClient = new GiteaClient({
			type: "gitea",
			url: "http://localhost:19992",
			token: "secret-token",
			owner: "o",
			repo: "r",
		});
		await authClient.comment("o", "r", 1, "test");
		expect(receivedAuth).toBe("token secret-token");
		authServer.stop();
	});
});