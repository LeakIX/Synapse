import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A stub opencode binary for tests.
 *
 * The script records every call, one per line, and prints one JSON
 * event that holds the text you give it. It answers like the real
 * binary run with --format json, so a scenario needs no model, no
 * network and no credentials.
 *
 * @param opts.text  text the run reports. Default "work done".
 * @param opts.exitCode  exit code of the run. Default 0.
 */
export function createStubOpenCode(opts?: {
	text?: string;
	exitCode?: number;
}): {
	/** Path to pass as the harness binary. */
	binary: string;
	/** Every call, one per line, argv joined by a space. */
	calls: () => string[];
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), "stub-opencode-"));
	const binary = join(dir, "opencode");
	const log = join(dir, "calls.log");
	const text = opts?.text ?? "work done";
	const exitCode = opts?.exitCode ?? 0;

	const script = [
		"#!/bin/sh",
		"# stub opencode for tests",
		`printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
		`printf '%s\\n' '{"type":"message","parts":[{"type":"text","text":${JSON.stringify(
			text,
		).replace(/'/g, "'\\''")}}]}'`,
		`exit ${exitCode}`,
		"",
	].join("\n");
	writeFileSync(binary, script, { mode: 0o755 });

	return {
		binary,
		calls: () =>
			existsSync(log)
				? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean)
				: [],
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}
