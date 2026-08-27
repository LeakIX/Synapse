/** Forge (code hosting) configuration. */
export interface ForgeConfig {
	/** Which forge implementation to use. */
	type: "gitea" | "github";
	/** Base URL of the forge instance. */
	url: string;
	/** API token, after env expansion. */
	token: string;
	/** Repository owner (org or user). */
	owner: string;
	/** Repository name. */
	repo: string;
}

/** Continuous integration system configuration. */
export interface CiConfig {
	/** Which CI implementation to use. */
	type: "drone" | "woodpecker" | "github-actions";
	/** Base URL of the CI instance. */
	url: string;
	/** API token, after env expansion. */
	token: string;
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
	type: "file";
	/** Directory for the file-based queue backend. */
	dir: string;
}

/** A single agent that can be assigned tasks. */
export interface AgentConfig {
	/** Unique name, used in @mentions. */
	name: string;
	/** Emoji the agent reacts with when claiming a task. */
	emoji: string;
	/** What this agent can do (informational, used for routing). */
	capabilities: string[];
	/** Command to invoke the agent (for future dispatch). */
	command?: string;
}

/** Webhook receiver configuration. */
export interface WebhookConfig {
	/** Port to listen on for incoming webhooks. */
	port: number;
	/** Shared secret for payload signature verification. */
	secret: string;
}

/** Event parser configuration. */
export interface ParserConfig {
	/** Which parser implementation to use. */
	type: "mention";
}

/** Logging configuration. */
export interface LogConfig {
	/** Minimum level to emit. */
	level: "debug" | "info" | "warn" | "error";
	/** Output format. */
	format: "text" | "json";
}

/** Top-level orchestrator configuration. */
export interface OrchestratorConfig {
	forge: ForgeConfig;
	ci: CiConfig;
	beads: BeadsConfig;
	queue: QueueConfig;
	agents: AgentConfig[];
	webhook: WebhookConfig;
	parser: ParserConfig;
	log: LogConfig;
}