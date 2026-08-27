import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type {
	OrchestratorConfig,
	ForgeConfig,
	CiConfig,
	ForgeType,
	CiType,
	ParserType,
	QueueType,
} from "./types.ts";
import type { LogLevel, LogFormat } from "../log/types.ts";
import type { GiteaApiVersion } from "../forge/gitea.ts";
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
	return input.replace(/\$\{([^}]+)\}/g, (_, interior: string) => {
		const sepIdx = interior.indexOf(":-");
		if (sepIdx === -1) {
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
	// Forges: accept both `forge:` (single) and `forges:` (array)
	const forges = parseForges(obj);
	const cis = parseCis(obj);
	const beads = obj.beads as Record<string, unknown>;
	const queue = obj.queue as Record<string, unknown>;
	const webhook = obj.webhook as Record<string, unknown>;
	const parser = obj.parser as Record<string, unknown>;
	const log = obj.log as Record<string, unknown>;

	if (!beads) throw new Error("config: missing required key \"beads\"");
	if (!queue) throw new Error("config: missing required key \"queue\"");
	if (!webhook) throw new Error("config: missing required key \"webhook\"");
	if (!parser) throw new Error("config: missing required key \"parser\"");
	if (!log) throw new Error("config: missing required key \"log\"");

	const agents = obj.agents;
	if (!Array.isArray(agents) || agents.length === 0) {
		throw new Error("config: agents must be a non-empty array");
	}

	return {
		forges,
		cis,
		beads: {
			dir: str(beads, "dir", "beads.dir"),
			binary: str(beads, "binary", "beads.binary"),
		},
		queue: {
			type: "file" satisfies QueueType,
			dir: str(queue, "dir", "queue.dir"),
		},
		agents: (agents as Record<string, unknown>[]).map((a, i) => ({
			name: str(a, "name", `agents[${i}].name`),
			emoji: str(a, "emoji", `agents[${i}].emoji`),
			command: a.command as string | undefined,
		})),
		webhook: {
			port: num(webhook, "port", "webhook.port"),
			secret: str(webhook, "secret", "webhook.secret"),
		},
		parser: {
			type: parser.type as ParserType,
		},
		log: {
			level: (log.level as LogLevel) ?? "info",
			format: (log.format as LogFormat) ?? "text",
		},
	};
}

function optionalStr(
	obj: Record<string, unknown>,
	key: string,
	fallback: string,
): string {
	const val = obj[key];
	if (typeof val === "string" && val.length > 0) return val;
	return fallback;
}

function parseForges(obj: Record<string, unknown>): ForgeConfig[] {
	const raw = obj.forges ?? obj.forge;
	if (raw === undefined) {
		throw new Error('config: missing required key "forges" (or "forge")');
	}
	const arr: Record<string, unknown>[] = Array.isArray(raw)
		? (raw as Record<string, unknown>[])
		: [raw as Record<string, unknown>];
	if (arr.length === 0) {
		throw new Error("config: forges must be a non-empty array");
	}
	return arr.map((f, i) => ({
		name: optionalStr(f, "name", `forge-${i + 1}`),
		type: f.type as ForgeType,
		url: str(f, "url", `forges[${i}].url`),
		token: str(f, "token", `forges[${i}].token`),
		owner: str(f, "owner", `forges[${i}].owner`),
		repo: str(f, "repo", `forges[${i}].repo`),
		apiVersion: (f.apiVersion as GiteaApiVersion | undefined) ?? undefined,
	}));
}

function parseCis(obj: Record<string, unknown>): CiConfig[] {
	const raw = obj.cis ?? obj.ci;
	if (raw === undefined) {
		return [];
	}
	const arr: Record<string, unknown>[] = Array.isArray(raw)
		? (raw as Record<string, unknown>[])
		: [raw as Record<string, unknown>];
	return arr.map((c, i) => ({
		name: optionalStr(c, "name", `ci-${i + 1}`),
		type: c.type as CiType,
		url: str(c, "url", `cis[${i}].url`),
		token: str(c, "token", `cis[${i}].token`),
		forge: optionalStr(c, "forge", "default"),
	}));
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