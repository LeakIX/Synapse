import type { Event, EventParser, ParsedInstruction } from "./types.ts";
import type { AgentConfig } from "../config/types.ts";

/**
 * Parses agent mentions from event payloads.
 *
 * Recognizes patterns like:
 *   @agent-name do X
 *   @agent-name do X now
 *   @agent-name fix the failing tests in PR #123
 *
 * The "now" keyword (case-insensitive, as a standalone word) sets urgency to "now".
 * A PR/issue number in the instruction (e.g. "#123") sets followUpAfter.
 */
export class MentionParser implements EventParser {
	#agents: AgentConfig[];

	constructor(agents: AgentConfig[]) {
		this.#agents = agents;
	}

	async parse(event: Event): Promise<ParsedInstruction[]> {
		if (event.kind !== "comment") return [];
		const body = (event.payload as { body: string }).body;
		const results: ParsedInstruction[] = [];

		for (const agent of this.#agents) {
			const mention = `@${agent.name}`;
			const idx = body.indexOf(mention);
			if (idx === -1) continue;

			const afterMention = body.slice(idx + mention.length);
			const instruction = afterMention.trim();
			if (!instruction) continue;

			const urgency = /(^|\s)now(\s|$)/i.test(afterMention)
				? "now"
				: "queued";

			const prMatch = afterMention.match(/#(\d+)/);
			const followUpAfter = prMatch ? Number(prMatch[1]) : undefined;

			results.push({
				agentName: agent.name,
				instruction,
				urgency,
				followUpAfter,
			});
		}

		return results;
	}
}