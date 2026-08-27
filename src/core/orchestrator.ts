import type { Event } from "../core/event.ts";
import type { IssueTracker } from "../issues/types.ts";
import type { QueueTask, TaskQueue } from "../queue/types.ts";
import type { ForgeClient } from "../forge/types.ts";
import type { EventParser, ParsedInstruction } from "../parser/types.ts";
import type { Logger } from "../log/types.ts";
import type { AgentConfig } from "../config/types.ts";
import type { CiGate } from "./ci-gate.ts";
import { randomUUID } from "node:crypto";

/**
 * The orchestrator. Wires together all the pluggable components.
 *
 * Depends only on interfaces:
 *   - IssueTracker: create/update/close beads issues
 *   - TaskQueue: publish tasks, watch for completion
 *   - ForgeClient: comment back on the forge
 *   - EventParser: extract instructions from events
 *   - Logger: log activity
 *   - AgentConfig[]: agent definitions
 *
 * Event handling:
 *   1. Receive an Event
 *   2. Filter out self-writes (agent-authored comments)
 *   3. Parse for agent mentions
 *   4. For each instruction: create a beads issue, publish to queue
 *   5. On task completion: comment back on the forge
 */
export class Orchestrator {
	#tracker: IssueTracker;
	#queue: TaskQueue;
	#forge: ForgeClient;
	#parser: EventParser;
	#logger: Logger;
	#agents: Map<string, AgentConfig>;
	#agentNames: Set<string>;
	#ciGate?: CiGate;

	constructor(deps: {
		tracker: IssueTracker;
		queue: TaskQueue;
		forge: ForgeClient;
		parser: EventParser;
		logger: Logger;
		agents: AgentConfig[];
		ciGate?: CiGate;
	}) {
		this.#tracker = deps.tracker;
		this.#queue = deps.queue;
		this.#forge = deps.forge;
		this.#parser = deps.parser;
		this.#logger = deps.logger;
		this.#agents = new Map(deps.agents.map((a) => [a.name, a]));
		this.#agentNames = new Set(deps.agents.map((a) => a.name));
		this.#ciGate = deps.ciGate;
	}

	/**
	 * Handle a single event. This is the main entry point.
	 * Returns the tasks that were published (for testing).
	 */
	async handleEvent(event: Event): Promise<QueueTask[]> {
		// Filter out self-writes
		if (this.#isSelfWrite(event)) {
			this.#logger.debug("ignoring self-write", {
				source: event.source,
				kind: event.kind,
			});
			return [];
		}

		// Parse for instructions
		const instructions = await this.#parser.parse(event);
		if (instructions.length === 0) {
			this.#logger.debug("no instructions found", {
				source: event.source,
				kind: event.kind,
			});
			return [];
		}

		this.#logger.info("instructions found", {
			count: instructions.length,
			source: event.source,
		});

		const tasks: QueueTask[] = [];
		for (const inst of instructions) {
			const task = await this.#createTask(event, inst);
			tasks.push(task);
		}
		return tasks;
	}

	/**
	 * Watch for task completions and report back to the forge.
	 * Returns a stop function.
	 */
	watchCompletions(): () => void {
		const stopDone = this.#queue.watchDone((task) => {
			void this.#onTaskDone(task);
		});
		const stopFailed = this.#queue.watchFailed((task) => {
			void this.#onTaskFailed(task);
		});
		return () => {
			stopDone();
			stopFailed();
		};
	}

	/** Check if the event was authored by one of our agents. */
	#isSelfWrite(event: Event): boolean {
		if (event.kind === "comment") {
			const author = (event.payload as { author: string }).author;
			return this.#agentNames.has(author);
		}
		return false;
	}

	async #createTask(
		event: Event,
		inst: ParsedInstruction,
	): Promise<QueueTask> {
		const agent = this.#agents.get(inst.agentName);
		if (!agent) {
			this.#logger.warn("unknown agent in instruction", {
				agent: inst.agentName,
			});
			throw new Error(`unknown agent: ${inst.agentName}`);
		}

		// Create a beads issue for tracking
		const issue = await this.#tracker.create(
			`[${inst.agentName}] ${inst.instruction.slice(0, 80)}`,
			{
				description: inst.instruction,
				type: "task",
				labels: [agent.name, `urgency-${inst.urgency}`],
			},
		);

		// Build forge context if the event came from a forge
		let forgeContext;
		if (event.kind === "comment") {
			const cp = event.payload as {
				owner: string;
				repo: string;
				number: number;
				commentId: number;
				url: string;
			};
			forgeContext = {
				owner: cp.owner,
				repo: cp.repo,
				number: cp.number,
				commentId: cp.commentId,
				url: cp.url,
			};
		}

		const task: QueueTask = {
			id: randomUUID(),
			issueId: issue.id,
			agent: inst.agentName,
			instruction: inst.instruction,
			forgeContext,
			followUpAfter: inst.followUpAfter,
			urgency: inst.urgency,
			createdAt: new Date().toISOString(),
		};

		// CI gate: if this is a follow-up, check CI before dispatching
		if (this.#ciGate && inst.followUpAfter !== undefined) {
			const ready = await this.#ciGate.isReady(task);
			if (!ready) {
				this.#logger.info("task held by CI gate", {
					taskId: task.id,
					followUpAfter: inst.followUpAfter,
				});
				// Update the issue to reflect it's waiting on CI
				await this.#tracker.update(issue.id, {
					status: "blocked",
				});
				// Don't publish to queue yet; return the task but mark it held
				return { ...task, claimedAt: undefined };
			}
		}

		await this.#queue.publish(task);
		this.#logger.info("task published", {
			taskId: task.id,
			issueId: issue.id,
			agent: inst.agentName,
			urgency: inst.urgency,
		});

		return task;
	}

	async #onTaskDone(task: QueueTask): Promise<void> {
		this.#logger.info("task completed", {
			taskId: task.id,
			agent: task.agent,
			summary: task.result?.summary,
		});

		// Close the beads issue
		try {
			await this.#tracker.close(task.issueId);
		} catch (err) {
			this.#logger.error("failed to close issue", {
				issueId: task.issueId,
				error: String(err),
			});
		}

		// Report back to the forge
		if (task.forgeContext) {
			const agent = this.#agents.get(task.agent);
			const emoji = agent?.emoji ?? "✅";
			const body = `${emoji} **${task.agent}** completed: ${task.result?.summary ?? "done"}`;
			try {
				await this.#forge.comment(
					task.forgeContext.owner,
					task.forgeContext.repo,
					task.forgeContext.number,
					body,
				);
				this.#logger.info("forge comment posted", {
					owner: task.forgeContext.owner,
					repo: task.forgeContext.repo,
					number: task.forgeContext.number,
				});
			} catch (err) {
				this.#logger.error("failed to comment on forge", {
					error: String(err),
				});
			}
		}

		// Archive the task
		await this.#queue.archive(task.id);
	}

	async #onTaskFailed(task: QueueTask): Promise<void> {
		this.#logger.error("task failed", {
			taskId: task.id,
			agent: task.agent,
			summary: task.result?.summary,
		});

		// Update the beads issue to reflect failure
		try {
			await this.#tracker.update(task.issueId, {
				status: "blocked",
			});
		} catch (err) {
			this.#logger.error("failed to update issue", {
				issueId: task.issueId,
				error: String(err),
			});
		}

		// Report back to the forge
		if (task.forgeContext) {
			const body = `⚠️ **${task.agent}** failed: ${task.result?.summary ?? "unknown error"}`;
			try {
				await this.#forge.comment(
					task.forgeContext.owner,
					task.forgeContext.repo,
					task.forgeContext.number,
					body,
				);
			} catch (err) {
				this.#logger.error("failed to comment on forge", {
					error: String(err),
				});
			}
		}

		await this.#queue.archive(task.id);
	}
}