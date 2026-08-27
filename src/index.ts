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
import type { CiClient } from "./ci/types.ts";
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

	// Forge clients (one per configured forge)
	const forgeClients = config.forges.map((f) => ({
		name: f.name,
		client:
			f.type === "gitea"
				? new GiteaClient(f, f.apiVersion ?? "v1")
				: new GitHubClient(f),
	}));

	// CI clients (one per configured CI)
	const ciClients = config.cis.map((c) => ({
		name: c.name,
		client: createCiClient(c),
	}));

	// CI gate: use the first CI client if available
	const firstCi = ciClients[0];
	const firstForge = config.forges[0];
	const ciGate =
		firstCi && firstForge
			? new CiGate(
					firstCi.client,
					logger,
					firstForge.owner,
					firstForge.repo,
				)
			: undefined;

	// Issue tracker
	const tracker: IssueTracker = new BeadsClient(
		config.beads.dir,
		config.beads.binary,
	);

	// Task queue
	const queue: TaskQueue = new FileQueue(config.queue.dir);

	// Event parser
	const parser: EventParser = new MentionParser(config.agents);

	// Event sources: one webhook source per forge + beads watch
	const sources: EventSource[] = config.forges.map(
		(f) => new ForgeWebhookSource(f, config.webhook),
	);
	sources.push(new BeadsWatchSource(config.beads));

	// Orchestrator
	const orchestrator = new Orchestrator({
		tracker,
		queue,
		forges: forgeClients,
		parser,
		logger,
		agents: config.agents,
		ciGate,
	});

	return { orchestrator, sources, logger };
}

function createCiClient(
	c: OrchestratorConfig["cis"][0],
): CiClient {
	switch (c.type) {
		case "drone":
			return new DroneClient(c);
		case "woodpecker":
			return new WoodpeckerClient(c);
		case "github-actions":
			return new GitHubActionsClient(c);
	}
}

/**
 * Main entry point. Loads config, creates the orchestrator, starts all sources.
 */
export async function main(): Promise<void> {
	const configPath = process.argv[2] ?? "config.yaml";
	const source = new YamlConfigSource(configPath);
	const config = source.load();

	const { orchestrator, sources, logger } = createOrchestrator(config);

	const stops = sources.map((s) =>
		s.start((event) => {
			void orchestrator.handleEvent(event);
		}),
	);

	const stopWatching = orchestrator.watchCompletions();

	logger.info("orchestrator started", {
		forges: config.forges.map((f) => `${f.name} (${f.type})`),
		cis: config.cis.map((c) => `${c.name} (${c.type})`),
		agents: config.agents.map((a) => a.name),
		webhookPort: config.webhook.port,
	});

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