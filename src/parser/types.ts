export type { Event } from "../core/event.ts";
import type { Event } from "../core/event.ts";

/**
 * Abstraction over event parsing (mention detection, LLM extraction, ...).
 * Takes a raw event and returns the parsed instructions to extract.
 */
export interface EventParser {
	/**
	 * Parse an event and extract agent mentions and instructions.
	 * Returns an empty array if the event contains no actionable instructions.
	 */
	parse(event: Event): Promise<ParsedInstruction[]>;
}

/** A single extracted instruction from an event. */
export interface ParsedInstruction {
	/** Name of the agent to assign. */
	agentName: string;
	/** Natural-language instruction for the agent. */
	instruction: string;
	/** "now" = urgent (e.g. "now" keyword present), "queued" = when free. */
	urgency: "now" | "queued";
	/** PR/issue number this instruction is a follow-up of, if any. */
	followUpAfter?: number;
}