/** Log severity levels, in increasing order. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Abstraction over logging. The orchestrator depends on this interface;
 * concrete implementations (stdout, file, OTLP) are swappable.
 */
export interface Logger {
	debug(msg: string, meta?: Record<string, unknown>): void;
	info(msg: string, meta?: Record<string, unknown>): void;
	warn(msg: string, meta?: Record<string, unknown>): void;
	error(msg: string, meta?: Record<string, unknown>): void;
}