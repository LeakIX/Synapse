import type { Event } from "../core/event.ts";

/**
 * Abstraction over event sources (webhooks, file watchers, CI callbacks, ...).
 * The orchestrator depends on this interface; concrete sources are swappable.
 */
export interface EventSource {
	/** Human-readable name for logging. */
	name: string;
	/** Start emitting events. Returns a stop function. */
	start(onEvent: (event: Event) => void): () => void;
}