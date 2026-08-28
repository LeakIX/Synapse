import type { GiteaApiVersion } from "../forge/gitea.ts";
import type { HarnessType } from "../harness/types.ts";
import type { LogLevel, LogFormat } from "../log/types.ts";

/** Which forge implementation to use. */
export type ForgeType = "gitea" | "github";

/** Which CI implementation to use. */
export type CiType = "drone" | "woodpecker" | "github-actions";

/** Which parser implementation to use. */
export type ParserType = "mention";

/** Which queue backend implementation to use. */
export type QueueType = "file";

/** Forge (code hosting) configuration. */
export interface ForgeConfig {
	/** Unique name for this forge, used to route events. */
	name: string;
	/** Which forge implementation to use. */
	type: ForgeType;
	/** Base URL of the forge instance. */
	url: string;
	/** API token, after env expansion. */
	token: string;
	/** Repository owner (org or user). */
	owner: string;
	/** Repository name. */
	repo: string;
	/** Gitea API version (v1 or v2). Only used when type is "gitea". */
	apiVersion?: GiteaApiVersion;
}

/** Continuous integration system configuration. */
export interface CiConfig {
	/** Unique name for this CI system. */
	name: string;
	/** Which CI implementation to use. */
	type: CiType;
	/** Base URL of the CI instance. */
	url: string;
	/** API token, after env expansion. */
	token: string;
	/** Which forge this CI is associated with (by name). */
	forge: string;
}

/** Beads issue tracker configuration. */
export interface BeadsConfig {
	/** Path to the repository containing the .beads/ directory. */
	dir: string;
	/** Path to the bd executable. */
	binary: string;
}

/** Task queue configuration. */
export interface QueueConfig {
	/** Queue backend implementation. */
	type: QueueType;
	/** Directory for the file-based queue backend. */
	dir: string;
}

/** A single agent that can be assigned tasks. */
export interface AgentConfig {
	/** Unique name, used in @mentions. */
	name: string;
	/** Emoji the agent reacts with when claiming a task. */
	emoji: string;
	/** Which harness performs the work. Default "opencode". */
	harness?: HarnessType;
	/** Command to run, when the harness is "command". */
	command?: string;
	/** Model the harness uses, as "provider/model-id". */
	model?: string;
	/** Directory the harness works in. */
	dir?: string;
}

/** Webhook receiver configuration. */
export interface WebhookConfig {
	/** Port to listen on for incoming webhooks. */
	port: number;
	/** Shared secret for payload signature verification. */
	secret: string;
}

/** Housekeeping loop configuration. */
export interface HousekeepingConfig {
	/** Time between housekeeping ticks, in milliseconds. */
	intervalMs: number;
}

/** Event parser configuration. */
export interface ParserConfig {
	/** Which parser implementation to use. */
	type: ParserType;
}

/** Logging configuration. */
export interface LogConfig {
	/** Minimum level to emit. */
	level: LogLevel;
	/** Output format. */
	format: LogFormat;
}

/** Top-level orchestrator configuration. */
export interface OrchestratorConfig {
	/** One or more forge instances. */
	forges: ForgeConfig[];
	/** One or more CI systems. */
	cis: CiConfig[];
	beads: BeadsConfig;
	queue: QueueConfig;
	agents: AgentConfig[];
	webhook: WebhookConfig;
	housekeeping: HousekeepingConfig;
	parser: ParserConfig;
	log: LogConfig;
}