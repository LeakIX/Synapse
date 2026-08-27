import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: { stop: () => void };
let port = 19960;
let repoDir: string;

beforeAll(async () => {
	const { startViewer } = await import("../../src/viewer/server.ts");
	repoDir = mkdtempSync(join(tmpdir(), "viewer-test-"));
	mkdirSync(join(repoDir, "queue", "pending"), { recursive: true });
	mkdirSync(join(repoDir, "queue", "active"), { recursive: true });
	mkdirSync(join(repoDir, "queue", "done"), { recursive: true });
	mkdirSync(join(repoDir, "queue", "failed"), { recursive: true });

	// Write a fake queue task
	writeFileSync(
		join(repoDir, "queue", "pending", "task-1.json"),
		JSON.stringify({
			id: "task-1",
			issueId: "test-abc.1",
			agent: "code-agent",
			instruction: "fix the bug",
			urgency: "queued",
			createdAt: new Date().toISOString(),
		}),
	);

	server = startViewer(port, repoDir);
	await new Promise((r) => setTimeout(r, 100));
});

afterAll(() => {
	server.stop();
	rmSync(repoDir, { recursive: true, force: true });
});

describe("Viewer server", () => {
	test("serves HTML on /", async () => {
		const res = await fetch(`http://localhost:${port}/`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("Synapse Brain");
		expect(text).toContain("tailwindcss");
	});

	test("/api/health returns ok", async () => {
		const res = await fetch(`http://localhost:${port}/api/health`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as Record<string, string>;
		expect(data.status).toBe("ok");
	});

	test("/api/queue returns tasks from the queue directory", async () => {
		const res = await fetch(`http://localhost:${port}/api/queue`);
		expect(res.status).toBe(200);
		const tasks = (await res.json()) as Array<{
			id: string;
			issue_id: string;
			agent: string;
			state: string;
		}>;
		expect(Array.isArray(tasks)).toBe(true);
		expect(tasks).toHaveLength(1);
		expect(tasks[0].id).toBe("task-1");
		expect(tasks[0].issue_id).toBe("test-abc.1");
		expect(tasks[0].agent).toBe("code-agent");
		expect(tasks[0].state).toBe("pending");
	});

	test("/api/queue returns array format", async () => {
		const res = await fetch(`http://localhost:${port}/api/queue`);
		const tasks = await res.json();
		expect(Array.isArray(tasks)).toBe(true);
	});

	test("/api/export returns array format", async () => {
		const res = await fetch(`http://localhost:${port}/api/export`);
		expect(res.status).toBe(200);
		const issues = await res.json();
		expect(Array.isArray(issues)).toBe(true);
	});

	test("unknown route returns 404", async () => {
		const res = await fetch(`http://localhost:${port}/nonexistent`);
		expect(res.status).toBe(404);
	});
});