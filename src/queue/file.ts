import {
	existsSync,
	mkdirSync,
	renameSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { QueueTask, TaskQueue, TaskResult } from "./types.ts";

/**
 * File-based TaskQueue.
 *
 * Directory layout:
 *   <dir>/pending/  - tasks waiting for an agent
 *   <dir>/active/   - tasks claimed by an agent
 *   <dir>/done/     - tasks completed successfully
 *   <dir>/held/     - tasks a gate holds, waiting to be released
 *   <dir>/failed/   - tasks that failed
 *   <dir>/archive/  - processed tasks, moved here after handling
 *
 * Each task is a JSON file named <taskId>.json.
 */
export class FileQueue implements TaskQueue {
	#dir: string;

	constructor(dir: string) {
		this.#dir = dir;
		mkdirSync(join(dir, "pending"), { recursive: true });
		mkdirSync(join(dir, "active"), { recursive: true });
		mkdirSync(join(dir, "done"), { recursive: true });
		mkdirSync(join(dir, "failed"), { recursive: true });
		mkdirSync(join(dir, "held"), { recursive: true });
		mkdirSync(join(dir, "archive"), { recursive: true });
	}

	async publish(task: QueueTask): Promise<void> {
		const path = join(this.#dir, "pending", `${task.id}.json`);
		writeFileSync(path, JSON.stringify(task, null, 2));
	}

	watchDone(onDone: (task: QueueTask) => void): () => void {
		const dir = join(this.#dir, "done");
		const interval = setInterval(() => {
			for (const file of this.#listFiles(dir)) {
				try {
					const raw = readFileSync(file, "utf-8");
					const task = JSON.parse(raw) as QueueTask;
					onDone(task);
					this.#moveToArchive(file);
				} catch {
					// file being written, skip this tick
				}
			}
		}, 500);
		return () => clearInterval(interval);
	}

	watchFailed(onFailed: (task: QueueTask) => void): () => void {
		const dir = join(this.#dir, "failed");
		const interval = setInterval(() => {
			for (const file of this.#listFiles(dir)) {
				try {
					const raw = readFileSync(file, "utf-8");
					const task = JSON.parse(raw) as QueueTask;
					onFailed(task);
					this.#moveToArchive(file);
				} catch {
					// file being written, skip this tick
				}
			}
		}, 500);
		return () => clearInterval(interval);
	}

	async hold(task: QueueTask): Promise<void> {
		const path = join(this.#dir, "held", `${task.id}.json`);
		writeFileSync(path, JSON.stringify(task, null, 2));
	}

	async listHeld(): Promise<QueueTask[]> {
		const held: QueueTask[] = [];
		for (const file of this.#listFiles(join(this.#dir, "held"))) {
			try {
				held.push(JSON.parse(readFileSync(file, "utf-8")) as QueueTask);
			} catch {
				// file being written, skip it
			}
		}
		return held;
	}

	async release(taskId: string): Promise<QueueTask | null> {
		const heldPath = join(this.#dir, "held", `${taskId}.json`);
		if (!existsSync(heldPath)) return null;
		const task = JSON.parse(readFileSync(heldPath, "utf-8")) as QueueTask;
		writeFileSync(
			join(this.#dir, "pending", `${taskId}.json`),
			JSON.stringify(task, null, 2),
		);
		unlinkSync(heldPath);
		return task;
	}

	async archive(taskId: string): Promise<void> {
		for (const sub of ["done", "failed", "active", "pending", "held"]) {
			const path = join(this.#dir, sub, `${taskId}.json`);
			if (existsSync(path)) {
				this.#moveToArchive(path);
				return;
			}
		}
	}

	async claim(agentName: string): Promise<QueueTask | null> {
		const pendingDir = join(this.#dir, "pending");
		const files = this.#listFiles(pendingDir);
		for (const file of files) {
			const raw = readFileSync(file, "utf-8");
			const task = JSON.parse(raw) as QueueTask;
			if (task.agent !== agentName) continue;
			// Atomic claim: rename from pending/ to active/
			const activePath = join(this.#dir, "active", `${task.id}.json`);
			task.claimedAt = new Date().toISOString();
			try {
				writeFileSync(activePath, JSON.stringify(task, null, 2));
				unlinkSync(file);
				return task;
			} catch {
				// lost the race, try next
				continue;
			}
		}
		return null;
	}

	async complete(taskId: string, result: TaskResult): Promise<void> {
		const activePath = join(this.#dir, "active", `${taskId}.json`);
		const raw = readFileSync(activePath, "utf-8");
		const task = JSON.parse(raw) as QueueTask;
		task.completedAt = new Date().toISOString();
		task.result = result;
		const donePath = join(this.#dir, "done", `${taskId}.json`);
		writeFileSync(donePath, JSON.stringify(task, null, 2));
		unlinkSync(activePath);
	}

	async fail(taskId: string, result: TaskResult): Promise<void> {
		const activePath = join(this.#dir, "active", `${taskId}.json`);
		const raw = readFileSync(activePath, "utf-8");
		const task = JSON.parse(raw) as QueueTask;
		task.completedAt = new Date().toISOString();
		task.result = result;
		const failedPath = join(this.#dir, "failed", `${taskId}.json`);
		writeFileSync(failedPath, JSON.stringify(task, null, 2));
		unlinkSync(activePath);
	}

	async detectStale(timeoutMs: number): Promise<QueueTask[]> {
		const activeDir = join(this.#dir, "active");
		const now = Date.now();
		const stale: QueueTask[] = [];
		for (const file of this.#listFiles(activeDir)) {
			try {
				const raw = readFileSync(file, "utf-8");
				const task = JSON.parse(raw) as QueueTask;
				if (task.claimedAt) {
					const age = now - new Date(task.claimedAt).getTime();
					if (age > timeoutMs) stale.push(task);
				}
			} catch {
				// skip unparseable
			}
		}
		return stale;
	}

	#listFiles(dir: string): string[] {
		if (!existsSync(dir)) return [];
		return readdirSync(dir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => join(dir, f));
	}

	#moveToArchive(srcPath: string): void {
		const fileName = srcPath.split("/").pop()!;
		const destPath = join(this.#dir, "archive", fileName);
		try {
			renameSync(srcPath, destPath);
		} catch {
			// already moved or deleted
		}
	}
}