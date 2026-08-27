import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { DroneClient } from "../../src/ci/drone.ts";
import { WoodpeckerClient } from "../../src/ci/woodpecker.ts";
import { GitHubActionsClient } from "../../src/ci/github-actions.ts";
import type { CiConfig } from "../../src/config/types.ts";

// Mock CI server
let server: ReturnType<typeof Bun.serve>;
const port = 19980;

function ciConfig(): CiConfig {
	return {
		type: "drone",
		url: `http://localhost:${port}`,
		token: "ci-token",
	};
}

beforeAll(() => {
	server = Bun.serve({
		port,
		async fetch(req: Request) {
			const url = new URL(req.url);

			// Drone/Woodpecker builds endpoint
			if (url.pathname === "/api/repos/testorg/testrepo/builds") {
				return Response.json([
					{
						status: "passed",
						link: "http://localhost:19980/testorg/testrepo/1",
						started: Date.now(),
						finished: Date.now(),
					},
				]);
			}

			// GitHub Actions checks endpoint
			if (url.pathname === "/repos/testorg/testrepo/pulls/42/checks") {
				return Response.json({
					total_count: 2,
					check_runs: [
						{ status: "completed", conclusion: "success" },
						{ status: "completed", conclusion: "success" },
					],
				});
			}

			// Failing build
			if (url.pathname === "/api/repos/failorg/failrepo/builds") {
				return Response.json([
					{
						status: "failed",
						link: "http://localhost:19980/failorg/failrepo/1",
						started: Date.now(),
						finished: Date.now(),
					},
				]);
			}

			// Pending build
			if (url.pathname === "/api/repos/pendorg/pendrepo/builds") {
				return Response.json([
					{
						status: "running",
						link: "http://localhost:19980/pendorg/pendrepo/1",
						started: Date.now(),
					},
				]);
			}

			// No builds
			if (url.pathname === "/api/repos/emptyorg/emptyrepo/builds") {
				return Response.json([]);
			}

			// GitHub Actions empty checks
			if (url.pathname === "/repos/emptyorg/emptyrepo/pulls/1/checks") {
				return Response.json({
					total_count: 0,
					check_runs: [],
				});
			}

			return new Response("not found", { status: 404 });
		},
	});
});

afterAll(() => {
	server.stop();
});

describe("DroneClient", () => {
	test("getBuild returns passing for passed builds", async () => {
		const client = new DroneClient(ciConfig());
		const build = await client.getBuild("testorg", "testrepo", 42);
		expect(build.status).toBe("passing");
		expect(build.prNumber).toBe(42);
	});

	test("isMerged returns true for passing builds", async () => {
		const client = new DroneClient(ciConfig());
		const merged = await client.isMerged("testorg", "testrepo", 42);
		expect(merged).toBe(true);
	});

	test("getBuild returns failing for failed builds", async () => {
		const client = new DroneClient(ciConfig());
		const build = await client.getBuild("failorg", "failrepo", 1);
		expect(build.status).toBe("failing");
	});

	test("getBuild returns pending for running builds", async () => {
		const client = new DroneClient(ciConfig());
		const build = await client.getBuild("pendorg", "pendrepo", 1);
		expect(build.status).toBe("pending");
	});

	test("getBuild returns pending for empty build list", async () => {
		const client = new DroneClient(ciConfig());
		const build = await client.getBuild("emptyorg", "emptyrepo", 1);
		expect(build.status).toBe("pending");
	});
});

describe("WoodpeckerClient", () => {
	test("getBuild returns passing for passed builds", async () => {
		const client = new WoodpeckerClient(ciConfig());
		const build = await client.getBuild("testorg", "testrepo", 42);
		expect(build.status).toBe("passing");
	});

	test("isMerged returns true for passing builds", async () => {
		const client = new WoodpeckerClient(ciConfig());
		const merged = await client.isMerged("testorg", "testrepo", 42);
		expect(merged).toBe(true);
	});
});

describe("GitHubActionsClient", () => {
	test("getBuild returns passing when all checks pass", async () => {
		const client = new GitHubActionsClient(ciConfig());
		const build = await client.getBuild("testorg", "testrepo", 42);
		expect(build.status).toBe("passing");
	});

	test("isMerged returns true when all checks pass", async () => {
		const client = new GitHubActionsClient(ciConfig());
		const merged = await client.isMerged("testorg", "testrepo", 42);
		expect(merged).toBe(true);
	});

	test("getBuild returns pending for empty checks", async () => {
		const client = new GitHubActionsClient(ciConfig());
		// Use a repo that returns empty checks
		const build = await client.getBuild("emptyorg", "emptyrepo", 1);
		expect(build.status).toBe("pending");
	});
});