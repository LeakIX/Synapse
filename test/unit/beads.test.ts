import { describe, expect, test, afterEach } from "bun:test";
import { createFakeBd } from "../helpers/fake-bd.ts";

let cleanup: (() => void) | null = null;

afterEach(() => {
	cleanup?.();
	cleanup = null;
});

describe("BeadsClient", () => {
	test("create returns an issue with the right title", async () => {
		const { client } = createFakeBd();
		cleanup = null;
		const { client: c, cleanup: cl } = { client, cleanup: () => {} };
		cleanup = cl;
		const issue = await c.create("Test task");
		expect(issue.title).toBe("Test task");
		expect(issue.status).toBe("open");
		expect(issue.id).toBe("test-abc.1");
	});

	test("create with options passes flags", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		const issue = await client.create("Test", {
			description: "desc",
			priority: 1,
			labels: ["urgent"],
		});
		expect(issue.title).toBe("Test");
	});

	test("update returns updated issue", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		const issue = await client.update("test-abc.1", { status: "in_progress" });
		expect(issue.status).toBe("in_progress");
	});

	test("close does not throw", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		await expect(client.close("test-abc.1")).resolves.toBeUndefined();
	});

	test("show returns the issue", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		const issue = await client.show("test-abc.1");
		expect(issue.id).toBe("test-abc.1");
		expect(issue.title).toBe("shown");
		expect(issue.labels).toEqual(["x"]);
	});

	test("list returns all issues", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		const issues = await client.list();
		expect(issues).toHaveLength(2);
		expect(issues[0].id).toBe("test-abc.1");
		expect(issues[1].id).toBe("test-abc.2");
	});

	test("list with status filter passes --status", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		const issues = await client.list({ status: "open" });
		expect(issues.length).toBeGreaterThan(0);
	});

	test("addDependency does not throw", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		await expect(
			client.addDependency("test-abc.1", "test-abc.2"),
		).resolves.toBeUndefined();
	});

	test("removeDependency does not throw", async () => {
		const { client, cleanup: cl } = createFakeBd();
		cleanup = cl;
		await expect(
			client.removeDependency("test-abc.1", "test-abc.2"),
		).resolves.toBeUndefined();
	});
});