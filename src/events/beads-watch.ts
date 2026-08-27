import { watch } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
	Event,
	BeadsChangePayload,
	BeadsChange,
} from "../core/event.ts";
import type { EventSource } from "../events/types.ts";
import type { BeadsConfig } from "../config/types.ts";
import type { IssueStatus, IssueType } from "../issues/types.ts";

/**
 * EventSource that watches the beads database for changes.
 *
 * Uses fs.watch on the .beads/ directory to detect file changes,
 * then shells out to `bd issue list --json` to get the current state.
 * Compares against the last known state to emit change events.
 */
export class BeadsWatchSource implements EventSource {
	readonly name = "beads-watch";
	#config: BeadsConfig;
	#lastState = new Map<string, string>();
	#watcher: ReturnType<typeof watch> | null = null;
	#debounceTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(config: BeadsConfig) {
		this.#config = config;
	}

	start(onEvent: (event: Event) => void): () => void {
		const beadsDir = join(this.#config.dir, ".beads");

		this.#watcher = watch(beadsDir, { persistent: false }, () => {
			if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
			this.#debounceTimer = setTimeout(() => {
				void this.#poll(onEvent);
			}, 1000);
		});

		return () => {
			this.#watcher?.close();
			this.#watcher = null;
			if (this.#debounceTimer) {
				clearTimeout(this.#debounceTimer);
				this.#debounceTimer = null;
			}
		};
	}

	async #poll(onEvent: (event: Event) => void): Promise<void> {
		try {
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const pExecFile = promisify(execFile);

			const { stdout } = await pExecFile(
				this.#config.binary,
				["issue", "list", "--json"],
				{ cwd: this.#config.dir, encoding: "utf-8" },
			);

			const issues = JSON.parse(stdout) as Record<string, unknown>[];
			const currentState = new Map<string, string>();

			for (const raw of issues) {
				const id = String(raw.id ?? "");
				const status = String(raw.status ?? "open");
				currentState.set(id, status);

				const prevStatus = this.#lastState.get(id);
				if (prevStatus === undefined) {
					onEvent(this.#makeEvent("created" satisfies BeadsChange, raw));
				} else if (prevStatus !== status) {
					const change: BeadsChange =
						status === "closed" ? "closed" : "updated";
					onEvent(this.#makeEvent(change, raw));
				}
			}

			// Detect removed issues (closed issues that disappeared)
			for (const [id, status] of this.#lastState) {
				if (!currentState.has(id) && status !== "closed") {
					onEvent({
						id: randomUUID(),
						source: this.name,
						kind: "beads_change",
						payload: {
							issueId: id,
							change: "closed",
						} satisfies BeadsChangePayload,
						receivedAt: new Date().toISOString(),
					});
				}
			}

			this.#lastState = currentState;
		} catch {
			// bd not available or no .beads dir, skip
		}
	}

	#makeEvent(
		change: BeadsChange,
		raw: Record<string, unknown>,
	): Event {
		return {
			id: randomUUID(),
			source: this.name,
			kind: "beads_change",
			payload: {
				issueId: String(raw.id ?? ""),
				change,
				issue: {
					id: String(raw.id ?? ""),
					title: String(raw.title ?? ""),
					description: String(raw.description ?? ""),
					status: (raw.status as IssueStatus) ?? "open",
					priority: Number(raw.priority ?? 2),
					type: (raw.type as IssueType) ?? "task",
					labels: (raw.labels as string[]) ?? [],
					createdAt: String(raw.created_at ?? ""),
					updatedAt: String(raw.updated_at ?? ""),
				},
			} satisfies BeadsChangePayload,
			receivedAt: new Date().toISOString(),
		};
	}
}