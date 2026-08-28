import type { TaskStatus } from "../queue/types.ts";

/** Which harness performs the work for an agent. */
export type HarnessType = "command" | "opencode";

/** What the harness must do. */
export interface HarnessTask {
	/** Natural language instruction, taken from the mention. */
	instruction: string;
	/** Task id, for logs. */
	taskId: string;
}

/** A single model entry reported by a harness. */
export interface HarnessModel {
	/** Model that did the work, as "provider/model-id". */
	model: string;
	/** URL used to reach this model. */
	url?: string;
}

/** What the harness reports back. */
export interface HarnessResult {
	status: TaskStatus;
	/**
	 * One line of what happened. The agent adds the model line, so a
	 * harness must not add it here.
	 */
	summary: string;
	/** Full output, kept on the task record. */
	output?: string;
	/** One model that did the work, kept for backward compatibility. */
	model?: string;
	/** URL used to reach the single model in `model`. */
	modelUrl?: string;
	/**
	 * Models that did the work. This supports model fleets.
	 * A harness that cannot tell leaves this out, and the agent uses its own default.
	 */
	models?: HarnessModel[];
}

/**
 * The system that performs a task: an AI coding harness, or any program.
 *
 * The agent owns the queue, the forge reaction and the reporting. The
 * harness owns nothing but the work, so a new harness is a new file and
 * one case in the factory, and the agent never changes.
 */
export interface AgentHarness {
	/** Name of the harness, as written in the config. */
	readonly name: HarnessType;
	/** Perform the task and report the result. Never throws. */
	run(task: HarnessTask): Promise<HarnessResult>;
}
