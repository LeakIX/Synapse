import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { OrchestratorConfig } from "./types.ts";
import type { ConfigSource } from "./source.ts";

/**
 * Configuration source that loads from a YAML file with ${VAR} env expansion.
 *
 * Usage:
 *   const source = new YamlConfigSource("./config.yaml");
 *   const config = source.load();
 */
export class YamlConfigSource implements ConfigSource {
	#path: string;

	constructor(path: string) {
		this.#path = path;
	}

	load(): OrchestratorConfig {
		const raw = readFileSync(this.#path, "utf-8");
		const expanded = expandEnvVars(raw);
		const obj = parse(expanded) as Record<string, unknown>;
		return validateConfig(obj);
	}
}

/** Replace ${VAR} and ${VAR:-default} patterns with env values. */
export function expandEnvVars(input: string): string {
	// Match ${VAR} or ${VAR:-default} using a single capture group for the
	// whole interior, then split on ":-" to extract name and default.
	return input.replace(/\$\{([^}]+)\}/g, (_, interior: string) => {
		const sepIdx = interior.indexOf(":-");
		if (sepIdx === -1) {
			// Simple ${VAR}
			return process.env[interior] ?? "";
		}
		const name = interior.slice(0, sepIdx);
		const def = interior.slice(sepIdx + 2);
		const val = process.env[name];
		return val !== undefined ? val : def;
	});
}

/** Validate the raw parsed object and return a typed OrchestratorConfig. */
export function validateConfig(
	obj: Record<string, unknown>,
): OrchestratorConfig {
	const forge = obj.forge as Record<string, unknown>;
	const ci = obj.ci as Record<string, unknown>;
	const beads = obj.beads as Record<string, unknown>;
	const queue = obj.queue as Record<string, unknown>;
	const webhook = obj.webhook as Record<string, unknown>;
	const parser = obj.parser as Record<string, unknown>;
	const log = obj.log as Record<string, unknown>;

	requireKey(obj, "forge", "forge config");
	requireKey(obj, "ci", "ci config");
	requireKey(obj, "beads", "beads config");
	requireKey(obj, "queue", "queue config");
	requireKey(obj, "webhook", "webhook config");
	requireKey(obj, "parser", "parser config");
	requireKey(obj, "log", "log config");

	const agents = obj.agents;
	if (!Array.isArray(agents) || agents.length === 0) {
		throw new Error("config: agents must be a non-empty array");
	}

	return {
		forge: {
			type: forge.type as "gitea" | "github",
			url: str(forge, "url", "forge.url"),
			token: str(forge, "token", "forge.token"),
			owner: str(forge, "owner", "forge.owner"),
			repo: str(forge, "repo", "forge.repo"),
		},
		ci: {
			type: ci.type as "drone" | "woodpecker" | "github-actions",
			url: str(ci, "url", "ci.url"),
			token: str(ci, "token", "ci.token"),
		},
		beads: {
			dir: str(beads, "dir", "beads.dir"),
			binary: str(beads, "binary", "beads.binary"),
		},
		queue: {
			type: "file",
			dir: str(queue, "dir", "queue.dir"),
		},
		agents: (agents as Record<string, unknown>[]).map((a, i) => ({
			name: str(a, "name", `agents[${i}].name`),
			emoji: str(a, "emoji", `agents[${i}].emoji`),
			capabilities: (a.capabilities as string[]) ?? [],
			command: a.command as string | undefined,
		})),
		webhook: {
			port: num(webhook, "port", "webhook.port"),
			secret: str(webhook, "secret", "webhook.secret"),
		},
		parser: {
			type: parser.type as "mention",
		},
		log: {
			level: (log.level as "debug" | "info" | "warn" | "error") ?? "info",
			format: (log.format as "text" | "json") ?? "text",
		},
	};
}

function requireKey(
	obj: Record<string, unknown>,
	key: string,
	label: string,
): void {
	if (!(key in obj)) {
		throw new Error(`config: missing required key "${key}" (${label})`);
	}
}

function str(
	obj: Record<string, unknown>,
	key: string,
	label: string,
): string {
	const val = obj[key];
	if (typeof val !== "string" || val.length === 0) {
		throw new Error(`config: ${label} must be a non-empty string`);
	}
	return val;
}

function num(
	obj: Record<string, unknown>,
	key: string,
	label: string,
): number {
	const val = obj[key];
	if (typeof val !== "number" || !Number.isFinite(val)) {
		throw new Error(`config: ${label} must be a number`);
	}
	return val;
}