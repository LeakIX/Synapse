import type { OrchestratorConfig } from "./types.ts";

/**
 * A source of configuration. The orchestrator depends on this interface;
 * concrete implementations (YAML, env, JSON) are swappable.
 */
export interface ConfigSource {
	/** Load and validate the configuration. Throws on invalid config. */
	load(): OrchestratorConfig;
}