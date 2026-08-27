import { YamlConfigSource } from "./config/yaml.ts";
import { BeadsClient } from "./issues/beads.ts";
import { FileQueue } from "./queue/file.ts";
import { GiteaClient } from "./forge/gitea.ts";
import { GitHubClient } from "./forge/github.ts";
import { DroneClient } from "./ci/drone.ts";
import { WoodpeckerClient } from "./ci/woodpecker.ts";
import { GitHubActionsClient } from "./ci/github-actions.ts";
import { MentionParser } from "./parser/mention.ts";
import { StdoutLogger } from "./log/stdout.ts";
import { ForgeWebhookSource } from "./events/forge-webhook.ts";
import { BeadsWatchSource } from "./events/beads-watch.ts";
import { Orchestrator } from "./core/orchestrator.ts";
import { CiGate } from "./core/ci-gate.ts";
import type { OrchestratorConfig } from "./config/types.ts";
import type { ForgeClient } from "./forge/types.ts";
import type { IssueTracker } from "./issues/types.ts";
import type { TaskQueue } from "./queue/types.ts";
import type { EventParser } from "./parser/types.ts";
import type { Logger } from "./log/types.ts";
import type { EventSource } from "./events/types.ts";

/**
 * Composition root. The only place that imports concrete implementations.
 * Wires everything together based on the config.
 */
export function createOrchestrator(
	config: OrchestratorConfig,
): {
	orchestrator: Orchestrator;
	sources: EventSource[];
	logger: Logger;
} {
	const logger = new StdoutLogger(config.log.level, config.log.format);

	// Forge client
	const forge: ForgeClient =
		config.forge.type === "gitea"
			? new GiteaClient(config.forge)
			: new GitHubClient(config.forge);

	// CI client + gate
	const ciClient =
		config.ci.type === "drone"
			? new DroneClient(config.ci)
			: config.ci.type === "woodpecker"
				? new WoodpeckerClient(config.ci)
				: new GitHubActionsClient(config.ci);
	const ciGate = new CiGate(
		ciClient,
		logger,
		config.forge.owner,
		config.forge.repo,
	);

	// Issue tracker
	const tracker: IssueTracker = new BeadsClient(
		config.beads.dir,
		config.beads.binary,
	);

	// Task queue
	const queue: TaskQueue = new FileQueue(config.queue.dir);

	// Event parser
	const parser: EventParser = new MentionParser(config.agents);

	// Event sources
	const sources: EventSource[] = [
		new ForgeWebhookSource(config.forge, config.webhook),
		new BeadsWatchSource(config.beads),
	];

	// Orchestrator
	const orchestrator = new Orchestrator({
		tracker,
		queue,
		forge,
		parser,
		logger,
		agents: config.agents,
		ciGate,
	});

	return { orchestrator, sources, logger };
}

/**
 * Main entry point. Loads config, creates the orchestrator, starts all sources.
 */
export async function main(): Promise<void> {
	const configPath = process.argv[2] ?? "config.yaml";
	const source = new YamlConfigSource(configPath);
	const config = source.load();

	const { orchestrator, sources, logger } = createOrchestrator(config);

	// Start all event sources
	const stops = sources.map((s) =>
		s.start((event) => {
			void orchestrator.handleEvent(event);
		}),
	);

	// Watch for task completions
	const stopWatching = orchestrator.watchCompletions();

	logger.info("orchestrator started", {
		forge: config.forge.type,
		ci: config.ci.type,
		agents: config.agents.map((a) => a.name),
		webhookPort: config.webhook.port,
	});

	// Handle graceful shutdown
	const shutdown = () => {
		logger.info("shutting down");
		stopWatching();
		for (const stop of stops) stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

// Run if executed directly
if (import.meta.main) {
	void main();
}