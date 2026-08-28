import type { QueueTask, TaskResult, TaskQueue } from "../queue/types.ts";
import type { ForgeClient } from "../forge/types.ts";
import type { Logger } from "../log/types.ts";
import type { AgentHarness } from "../harness/types.ts";
import { CommandHarness } from "../harness/command.ts";
import { OpenCodeHarness } from "../harness/opencode.ts";
import type { AgentConfig } from "../config/types.ts";

/**
 * An AI agent that claims tasks from the queue, executes them,
 * and reports the result back.
 *
 * The agent:
 *  1. Polls the queue for tasks matching its name.
 *  2. Reacts with its emoji on the forge comment when it claims a task.
 *  3. Executes the instruction through its harness.
 *  4. Records the model in the result summary.
 *  5. Marks the task as complete or failed.
 */
export class Agent {
	#name: string;
	#emoji: string;
	#harness: AgentHarness;
	#queue: TaskQueue;
	#forge: ForgeClient;
	#logger: Logger;
	#model: string;
	#pollIntervalMs: number;
	#running: boolean;

	constructor(opts: {
		name: string;
		emoji: string;
		/** The system that performs the work. */
		harness: AgentHarness;
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
		this.#harness = opts.harness;
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
			harness: this.#harness.name,
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
		const result = await this.#harness.run({
			instruction: task.instruction,
			taskId: task.id,
		});
		return {
			status: result.status,
			summary: `${result.summary}\nModel: ${result.model ?? this.#model}`,
			output: result.output,
		};
	}
}

/**
 * Build the harness one agent uses.
 *
 * OpenCode is the default, so an agent needs no harness field. An agent
 * with harness "command" runs a shell command and must set one.
 */
export function createHarness(
	agentConfig: AgentConfig,
	model: string,
): AgentHarness {
	const type = agentConfig.harness ?? "opencode";
	switch (type) {
		case "command":
			if (!agentConfig.command) {
				throw new Error(
					`agent ${agentConfig.name} uses the command harness but sets no command`,
				);
			}
			return new CommandHarness({ command: agentConfig.command });
		case "opencode":
			return new OpenCodeHarness({
				model: agentConfig.model ?? model,
				dir: agentConfig.dir,
			});
	}
}

/**
 * Load an agent from the orchestrator config and wire it up.
 * Returns the agent and a stop function.
 */
export function createAgent(
	config: {
		agents: AgentConfig[];
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
	const harness = createHarness(agentConfig, model);

	const forge = config.forges[0]?.client;
	if (!forge) {
		throw new Error("no forge configured for agent");
	}

	const agent = new Agent({
		name: agentConfig.name,
		emoji: agentConfig.emoji,
		harness,
		queue: config.queue,
		forge,
		logger: config.logger,
		model,
	});

	const stop = agent.start();
	return { agent, stop };
}