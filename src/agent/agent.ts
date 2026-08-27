import type { QueueTask, TaskResult, TaskQueue } from "../queue/types.ts";
import type { ForgeClient } from "../forge/types.ts";
import type { Logger } from "../log/types.ts";

/**
 * An AI agent that claims tasks from the queue, executes them,
 * and reports the result back.
 *
 * The agent:
 *  1. Polls the queue for tasks matching its name.
 *  2. Reacts with its emoji on the forge comment when it claims a task.
 *  3. Executes the instruction via its command.
 *  4. Records the model in the result summary.
 *  5. Marks the task as complete or failed.
 */
export class Agent {
	#name: string;
	#emoji: string;
	#command: string;
	#queue: TaskQueue;
	#forge: ForgeClient;
	#logger: Logger;
	#model: string;
	#pollIntervalMs: number;
	#running: boolean;

	constructor(opts: {
		name: string;
		emoji: string;
		/** Shell command to execute for each task. */
		command: string;
		queue: TaskQueue;
		forge: ForgeClient;
		logger: Logger;
		/** Model identifier, recorded in the result. */
		model: string;
		/** How often to poll the queue, in ms. Default 5000. */
		pollIntervalMs?: number;
	}) {
		this.#name = opts.name;
		this.#emoji = opts.emoji;
		this.#command = opts.command;
		this.#queue = opts.queue;
		this.#forge = opts.forge;
		this.#logger = opts.logger;
		this.#model = opts.model;
		this.#pollIntervalMs = opts.pollIntervalMs ?? 5000;
		this.#running = false;
	}

	/** Change the poll interval. Takes effect on the next cycle. */
	setPollInterval(ms: number): void {
		this.#pollIntervalMs = ms;
	}

	/**
	 * Start the agent polling loop.
	 * Returns a stop function.
	 */
	start(): () => void {
		this.#running = true;
		this.#logger.info("agent started", {
			agent: this.#name,
			model: this.#model,
		});

		const interval = setInterval(() => {
			if (!this.#running) return;
			void this.#poll();
		}, this.#pollIntervalMs);

		// First poll immediately
		void this.#poll();

		return () => {
			this.#running = false;
			clearInterval(interval);
			this.#logger.info("agent stopped", { agent: this.#name });
		};
	}

	async #poll(): Promise<void> {
		const task = await this.#queue.claim(this.#name);
		if (!task) return;

		this.#logger.info("task claimed", {
			taskId: task.id,
			issueId: task.issueId,
		});

		// React with emoji on the forge comment
		if (task.forgeContext?.commentId) {
			try {
				await this.#forge.react(
					task.forgeContext.owner,
					task.forgeContext.repo,
					task.forgeContext.number,
					task.forgeContext.commentId,
					this.#emoji,
				);
				this.#logger.info("reacted on forge", {
					taskId: task.id,
					emoji: this.#emoji,
				});
			} catch (err) {
				this.#logger.warn("failed to react on forge", {
					taskId: task.id,
					error: String(err),
				});
			}
		}

		// Execute the task
		const result = await this.#execute(task);

		// Report back
		if (result.status === "success") {
			await this.#queue.complete(task.id, result);
			this.#logger.info("task completed", {
				taskId: task.id,
				summary: result.summary,
			});
		} else {
			await this.#queue.fail(task.id, result);
			this.#logger.error("task failed", {
				taskId: task.id,
				summary: result.summary,
			});
		}
	}

	async #execute(task: QueueTask): Promise<TaskResult> {
		const { exec } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const pExec = promisify(exec);

		try {
			const { stdout, stderr } = await pExec(
				`${this.#command} ${JSON.stringify(task.instruction)}`,
				{
					timeout: 300_000,
					maxBuffer: 10 * 1024 * 1024,
					encoding: "utf-8",
				},
			);

			const output = [stdout, stderr].filter(Boolean).join("\n");
			const summary = this.#makeSummary(output, true);
			return {
				status: "success",
				summary,
				output: output || undefined,
			};
		} catch (err) {
			const errStr = String(err);
			const summary = this.#makeSummary(errStr, false);
			return {
				status: "failure",
				summary,
				output: errStr,
			};
		}
	}

	/**
	 * Build the result summary. The last line is always the model
	 * that performed the work, per the agent protocol.
	 */
	#makeSummary(output: string, success: boolean): string {
		const lines = output.trim().split("\n").filter(Boolean);
		const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
		const prefix = success ? "done" : "failed";
		const detail = lastLine.slice(0, 200);
		return `${prefix}: ${detail}\nModel: ${this.#model}`;
	}
}

/**
 * Load an agent from the orchestrator config and wire it up.
 * Returns the agent and a stop function.
 */
export function createAgent(
	config: {
		agents: Array<{ name: string; emoji: string; command?: string }>;
		queue: TaskQueue;
		forges: Array<{ name: string; client: ForgeClient }>;
		logger: Logger;
	},
	agentName: string,
	model: string,
): { agent: Agent; stop: () => void } {
	const agentConfig = config.agents.find((a) => a.name === agentName);
	if (!agentConfig) {
		throw new Error(`agent not found in config: ${agentName}`);
	}
	if (!agentConfig.command) {
		throw new Error(
			`agent ${agentName} has no command configured; cannot run`,
		);
	}

	const forge = config.forges[0]?.client;
	if (!forge) {
		throw new Error("no forge configured for agent");
	}

	const agent = new Agent({
		name: agentConfig.name,
		emoji: agentConfig.emoji,
		command: agentConfig.command,
		queue: config.queue,
		forge,
		logger: config.logger,
		model,
	});

	const stop = agent.start();
	return { agent, stop };
}