import { exec } from "node:child_process";
import { promisify } from "node:util";
import type {
	AgentHarness,
	HarnessResult,
	HarnessTask,
	HarnessType,
} from "./types.ts";

const pExec = promisify(exec);

/** How long a command may run before the harness kills it. */
const TIMEOUT_MS = 300_000;
/** How much output the harness keeps. */
const MAX_BUFFER = 10 * 1024 * 1024;

/**
 * Harness that runs a shell command.
 *
 * The command receives the instruction as a single quoted argument:
 *
 *   <command> "fix the failing test"
 *
 * A zero exit code is a success. Any other exit code, and a timeout, is
 * a failure. The summary is the last line the command printed.
 *
 * The harness reports no model. A shell command cannot tell which model,
 * if any, did the work, so the agent reports the model it was started
 * with.
 */
export class CommandHarness implements AgentHarness {
	readonly name: HarnessType = "command";
	#command: string;

	constructor(opts: {
		/** Program to run. The instruction follows as one argument. */
		command: string;
	}) {
		this.#command = opts.command;
	}

	async run(task: HarnessTask): Promise<HarnessResult> {
		try {
			const { stdout, stderr } = await pExec(
				`${this.#command} ${JSON.stringify(task.instruction)}`,
				{
					timeout: TIMEOUT_MS,
					maxBuffer: MAX_BUFFER,
					encoding: "utf-8",
				},
			);
			const output = [stdout, stderr].filter(Boolean).join("\n");
			return {
				status: "success",
				summary: `done: ${lastLine(output)}`,
				output: output || undefined,
			};
		} catch (err) {
			const output = String(err);
			return {
				status: "failure",
				summary: `failed: ${lastLine(output)}`,
				output,
			};
		}
	}
}

/** Last non-empty line of the output, capped at 200 characters. */
export function lastLine(output: string): string {
	const lines = output.trim().split("\n").filter(Boolean);
	const last = lines.length > 0 ? lines[lines.length - 1] : "";
	return (last ?? "").slice(0, 200);
}
