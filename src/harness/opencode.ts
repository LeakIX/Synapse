import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	AgentHarness,
	HarnessResult,
	HarnessTask,
	HarnessType,
} from "./types.ts";
import { lastLine } from "./command.ts";

const pExecFile = promisify(execFile);

/** How long one run may take before the harness kills it. */
const TIMEOUT_MS = 900_000;
/** How much output the harness keeps. */
const MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Harness that runs OpenCode, the default harness.
 *
 * The call is the non-interactive form of the CLI:
 *
 *   opencode run "<instruction>" --format json --model <provider/model>
 *     --dir <workdir> --agent <agent>
 *
 * The instruction comes from a comment on a forge, so it is untrusted
 * input. The harness runs the binary directly, with the instruction as
 * one argument, and never through a shell.
 *
 * OUTPUT: --format json makes OpenCode print raw JSON events. The
 * harness parses stdout as line delimited JSON and takes the last text
 * it finds as the summary. It falls back to the last line of raw output
 * when a line does not parse, so a change in the event shape degrades
 * the summary and never fails the task. A run that prints nothing is
 * still a success when the exit code says so; the summary then says the
 * run printed nothing.
 */
export class OpenCodeHarness implements AgentHarness {
	readonly name: HarnessType = "opencode";
	#binary: string;
	#model?: string;
	#dir?: string;
	#agent?: string;
	#timeoutMs: number;

	constructor(opts?: {
		/** Path to the opencode binary. Default "opencode" on PATH. */
		binary?: string;
		/** Model, as "provider/model-id". OpenCode picks one if unset. */
		model?: string;
		/** Directory OpenCode works in. Default the agent's directory. */
		dir?: string;
		/** Named OpenCode agent to run as. */
		agent?: string;
		/** How long one run may take. Default 15 minutes. */
		timeoutMs?: number;
	}) {
		this.#binary = opts?.binary ?? "opencode";
		this.#model = opts?.model;
		this.#dir = opts?.dir;
		this.#agent = opts?.agent;
		this.#timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
	}

	/** Arguments the harness passes to the binary. Exported for tests. */
	argsFor(instruction: string): string[] {
		const args = ["run", instruction, "--format", "json"];
		if (this.#model) args.push("--model", this.#model);
		if (this.#dir) args.push("--dir", this.#dir);
		if (this.#agent) args.push("--agent", this.#agent);
		return args;
	}

	async run(task: HarnessTask): Promise<HarnessResult> {
		try {
			const { stdout, stderr } = await pExecFile(
				this.#binary,
				this.argsFor(task.instruction),
				{
					timeout: this.#timeoutMs,
					maxBuffer: MAX_BUFFER,
					encoding: "utf-8",
					cwd: this.#dir,
				},
			);
			const output = [stdout, stderr].filter(Boolean).join("\n");
			return {
				status: "success",
				summary: `done: ${summarize(stdout) || "the run printed nothing"}`,
				output: output || undefined,
				model: this.#model,
			};
		} catch (err) {
			const output = String(err);
			return {
				status: "failure",
				summary: `failed: ${lastLine(output)}`,
				output,
				model: this.#model,
			};
		}
	}
}

/**
 * Take the last text OpenCode printed.
 *
 * Reads stdout as line delimited JSON and keeps every string under a
 * "text" key, at any depth. Falls back to the last raw line when no
 * line parses, so an unknown event shape still gives a summary.
 */
export function summarize(stdout: string): string {
	const texts: string[] = [];
	let parsedAny = false;

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let value: unknown;
		try {
			value = JSON.parse(trimmed);
		} catch {
			continue;
		}
		parsedAny = true;
		collectText(value, texts);
	}

	if (!parsedAny) return lastLine(stdout);
	const last = texts.filter((t) => t.trim()).pop();
	return (last ?? "").trim().split("\n").filter(Boolean).pop()?.slice(0, 200) ?? "";
}

/** Collect every string held under a "text" key, at any depth. */
function collectText(value: unknown, out: string[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectText(item, out);
		return;
	}
	if (value === null || typeof value !== "object") return;
	for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
		if (key === "text" && typeof v === "string") out.push(v);
		else collectText(v, out);
	}
}
