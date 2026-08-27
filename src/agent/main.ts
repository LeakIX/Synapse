import { YamlConfigSource } from "../config/yaml.ts";
import { FileQueue } from "../queue/file.ts";
import { GiteaClient } from "../forge/gitea.ts";
import { GitHubClient } from "../forge/github.ts";
import { StdoutLogger } from "../log/stdout.ts";
import { createAgent } from "./agent.ts";

/**
 * Agent entry point.
 *
 * Usage:
 *   bun run src/agent/main.ts --agent code-agent --model ollama/llama3
 *   bun run src/agent/main.ts --agent code-agent --model ollama/llama3 --config config.yaml
 *
 * The agent polls the queue for tasks matching its name, executes them,
 * and reports the result back. It records the model in every result.
 */

function parseArgs() {
	const args = process.argv.slice(2);
	let agentName = "";
	let model = "unknown/unknown";
	let configPath = "config.yaml";
	let pollIntervalMs = 5000;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--agent" && i + 1 < args.length) {
			agentName = args[i + 1];
			i++;
		} else if (args[i] === "--model" && i + 1 < args.length) {
			model = args[i + 1];
			i++;
		} else if (args[i] === "--config" && i + 1 < args.length) {
			configPath = args[i + 1];
			i++;
		} else if (args[i] === "--poll" && i + 1 < args.length) {
			pollIntervalMs = Number(args[i + 1]);
			i++;
		}
	}

	if (!agentName) {
		console.error("Usage: bun run src/agent/main.ts --agent <name> --model <provider/model> [--config path] [--poll ms]");
		process.exit(1);
	}

	return { agentName, model, configPath, pollIntervalMs };
}

export async function main(): Promise<void> {
	const { agentName, model, configPath, pollIntervalMs } = parseArgs();

	const source = new YamlConfigSource(configPath);
	const config = source.load();

	const logger = new StdoutLogger(config.log.level, config.log.format);

	// Queue
	const queue = new FileQueue(config.queue.dir);

	// Forge clients
	const forgeClients = config.forges.map((f) => ({
		name: f.name,
		client:
			f.type === "gitea"
				? new GiteaClient(f, f.apiVersion ?? "v1")
				: new GitHubClient(f),
	}));

	// Create the agent
	const { agent, stop } = createAgent(
		{
			agents: config.agents,
			queue,
			forges: forgeClients,
			logger,
		},
		agentName,
		model,
	);

	// Override poll interval if specified via CLI
	if (pollIntervalMs !== 5000) {
		agent.setPollInterval(pollIntervalMs);
	}

	logger.info("agent ready", {
		agent: agentName,
		model,
		queue: config.queue.dir,
	});

	// Graceful shutdown
	const shutdown = () => {
		logger.info("shutting down");
		stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Run forever
	await new Promise(() => {});
}

if (import.meta.main) {
	void main();
}