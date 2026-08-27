import type { Logger, LogLevel } from "./types.ts";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/**
 * Logger that writes to stdout.
 * Supports "text" (human-readable) and "json" (machine-parseable) formats.
 */
export class StdoutLogger implements Logger {
	#level: LogLevel;
	#format: "text" | "json";

	constructor(level: LogLevel = "info", format: "text" | "json" = "text") {
		this.#level = level;
		this.#format = format;
	}

	debug(msg: string, meta?: Record<string, unknown>): void {
		this.#log("debug", msg, meta);
	}

	info(msg: string, meta?: Record<string, unknown>): void {
		this.#log("info", msg, meta);
	}

	warn(msg: string, meta?: Record<string, unknown>): void {
		this.#log("warn", msg, meta);
	}

	error(msg: string, meta?: Record<string, unknown>): void {
		this.#log("error", msg, meta);
	}

	#log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#level]) return;
		const ts = new Date().toISOString();
		if (this.#format === "json") {
			console.log(JSON.stringify({ level, ts, msg, ...meta }));
		} else {
			const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
			console.log(`${ts} [${level.toUpperCase()}] ${msg}${metaStr}`);
		}
	}
}