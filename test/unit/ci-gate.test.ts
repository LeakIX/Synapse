import { describe, expect, test } from "bun:test";
import { CiGate } from "../../src/core/ci-gate.ts";
import type { CiClient, CiBuild, CiStatus } from "../../src/ci/types.ts";
import type { QueueTask } from "../../src/queue/types.ts";
import type { Logger } from "../../src/log/types.ts";

const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

/** Mock CI client with configurable status. */
class MockCi implements CiClient {
	status: CiStatus;
	constructor(status: CiStatus = "passing") {
		this.status = status;
	}
	async isMerged(
		_o: string,
		_r: string,
		_prNumber: number,
	): Promise<boolean> {
		return this.status === "passing";
	}
	async getBuild(
		_o: string,
		_r: string,
		prNumber: number,
	): Promise<CiBuild> {
		return {
			prNumber,
			status: this.status,
			url: "http://ci/build/1",
			startedAt: new Date().toISOString(),
		};
	}
}

function makeTask(overrides: Partial<QueueTask> = {}): QueueTask {
	return {
		id: "task-1",
		issueId: "issue-1",
		agent: "code-agent",
		instruction: "do something",
		urgency: "queued",
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("CiGate", () => {
	test("returns true for tasks without followUpAfter", async () => {
		const gate = new CiGate(
			new MockCi("passing"),
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: undefined });
		expect(await gate.isReady(task)).toBe(true);
	});

	test("returns true when CI is passing", async () => {
		const gate = new CiGate(
			new MockCi("passing"),
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: 42 });
		expect(await gate.isReady(task)).toBe(true);
	});

	test("returns false when CI is failing", async () => {
		const gate = new CiGate(
			new MockCi("failing"),
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: 42 });
		expect(await gate.isReady(task)).toBe(false);
	});

	test("returns false when CI is pending", async () => {
		const gate = new CiGate(
			new MockCi("pending"),
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: 42 });
		expect(await gate.isReady(task)).toBe(false);
	});

	test("returns false when CI check throws", async () => {
		class ErrorCi implements CiClient {
			async isMerged(): Promise<boolean> {
				throw new Error("CI unavailable");
			}
			async getBuild(): Promise<CiBuild> {
				throw new Error("CI unavailable");
			}
		}
		const gate = new CiGate(
			new ErrorCi(),
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: 42 });
		expect(await gate.isReady(task)).toBe(false);
	});

	test("CI status change: failing then passing", async () => {
		const ci = new MockCi("failing");
		const gate = new CiGate(
			ci,
			silentLogger,
			"org",
			"repo",
		);
		const task = makeTask({ followUpAfter: 42 });

		// Initially blocked
		expect(await gate.isReady(task)).toBe(false);

		// CI passes
		ci.status = "passing";
		expect(await gate.isReady(task)).toBe(true);
	});
});