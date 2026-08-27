import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import type {
	OrchestratorConfig,
	ForgeConfig,
	CiConfig,
	AgentConfig,
	ForgeType,
	CiType,
	ParserType,
	QueueType,
} from "./config/types.ts";
import type { LogLevel, LogFormat } from "./log/types.ts";

/**
 * Interactive setup CLI.
 *
 * Usage:
 *   bun run setup [path/to/config.yaml]
 *
 * Walks the user through configuring forges, CIs, agents, beads, queue,
 * webhook, parser, and logging. Writes the result as YAML.
 */

const readline = await import("node:readline/promises");
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

async function prompt(
	question: string,
	defaultValue?: string,
): Promise<string> {
	const suffix = defaultValue ? ` (${defaultValue})` : "";
	const answer = (await rl.question(`${question}${suffix}: `)).trim();
	if (!answer && defaultValue) return defaultValue;
	return answer;
}

async function promptSelect(
	question: string,
	options: string[],
	defaultIndex = 0,
): Promise<string> {
	console.log(question);
	options.forEach((opt, i) => {
		const marker = i === defaultIndex ? "→" : " ";
		console.log(`  ${marker} ${i + 1}) ${opt}`);
	});
	const answer = (
		await rl.question(`Select [${defaultIndex + 1}]: `)
	).trim();
	const idx = answer ? parseInt(answer) - 1 : defaultIndex;
	if (idx < 0 || idx >= options.length) {
		console.log(`Invalid selection, using default: ${options[defaultIndex]}`);
		return options[defaultIndex];
	}
	return options[idx];
}

async function promptBool(
	question: string,
	defaultValue = false,
): Promise<boolean> {
	const def = defaultValue ? "Y/n" : "y/N";
	const answer = (await rl.question(`${question} [${def}]: `)).trim().toLowerCase();
	if (!answer) return defaultValue;
	return answer === "y" || answer === "yes";
}

async function promptPort(
	question: string,
	defaultValue: number,
): Promise<number> {
	const answer = (
		await rl.question(`${question} (${defaultValue}): `)
	).trim();
	if (!answer) return defaultValue;
	const n = parseInt(answer);
	if (isNaN(n) || n < 1 || n > 65535) {
		console.log(`Invalid port, using default: ${defaultValue}`);
		return defaultValue;
	}
	return n;
}

async function addForge(existing: ForgeConfig[]): Promise<ForgeConfig[]> {
	console.log("\n--- Add Forge ---");
	const name = await prompt("Name (e.g. primary, secondary):", "forge-1");
	const type = await promptSelect(
		"Type:",
		["gitea", "github"],
		0,
	);
	const url = await prompt(
		"URL:",
		type === "gitea" ? "https://git.example.com" : "https://github.com",
	);
	const token = await prompt("API token (env var name or value):", "${FORGE_TOKEN}");
	const owner = await prompt("Owner (org/user):");
	const repo = await prompt("Repo:");

	const forge: ForgeConfig = {
		name,
		type: type as ForgeType,
		url,
		token,
		owner,
		repo,
	};
	const updated = [...existing, forge];

	const more = await promptBool("Add another forge?", false);
	if (more) return addForge(updated);
	return updated;
}

async function addCi(
	existing: CiConfig[],
	forges: ForgeConfig[],
): Promise<CiConfig[]> {
	console.log("\n--- Add CI ---");
	const name = await prompt("Name (e.g. drone-primary):", "ci-1");
	const type = await promptSelect(
		"Type:",
		["drone", "woodpecker", "github-actions"],
		0,
	);
	const url = await prompt(
		"URL:",
		type === "drone"
			? "https://ci.example.com"
			: type === "woodpecker"
				? "https://ci.example.com"
				: "https://api.github.com",
	);
	const token = await prompt("API token (env var name or value):", "${CI_TOKEN}");

	// Associate with a forge
	let forgeName: string;
	if (forges.length === 1) {
		forgeName = forges[0].name;
	} else if (forges.length === 0) {
		forgeName = "default";
	} else {
		const forgeNames = forges.map((f) => f.name);
		forgeName = await promptSelect(
			"Associated forge:",
			forgeNames,
			0,
		);
	}

	const ci: CiConfig = {
		name,
		type: type as CiType,
		url,
		token,
		forge: forgeName,
	};
	const updated = [...existing, ci];

	const more = await promptBool("Add another CI?", false);
	if (more) return addCi(updated, forges);
	return updated;
}

async function addAgent(existing: AgentConfig[]): Promise<AgentConfig[]> {
	console.log("\n--- Add Agent ---");
	const name = await prompt("Name (used in @mentions):", "code-agent");
	const emoji = await promptSelect(
		"Emoji:",
		["🔧", "🧪", "👀", "📝", "🤖"],
		0,
	);

	const agent: AgentConfig = { name, emoji };
	const updated = [...existing, agent];

	const more = await promptBool("Add another agent?", false);
	if (more) return addAgent(updated);
	return updated;
}

export async function runSetup(configPath: string = "config.yaml"): Promise<OrchestratorConfig> {
	console.log("=== Synapse setup ===\n");

	// Load existing config if present
	let config: Record<string, unknown> = {};
	if (existsSync(configPath)) {
		try {
			const raw = readFileSync(configPath, "utf-8");
			config = parse(raw) as Record<string, unknown>;
			console.log(`Loaded existing config from ${configPath}\n`);
		} catch {
			console.log(`Could not parse ${configPath}, starting fresh.\n`);
		}
	}

	// Forges
	let forges: ForgeConfig[] = [];
	if (Array.isArray(config.forges)) {
		forges = (config.forges as Record<string, unknown>[]).map(
			(f) => f as unknown as ForgeConfig,
		);
	} else if (config.forge) {
		const f = config.forge as Record<string, unknown>;
		forges = [
			{
				name: (f.name as string) ?? "default",
				type: (f.type as ForgeType) ?? "gitea",
				url: f.url as string,
				token: f.token as string,
				owner: f.owner as string,
				repo: f.repo as string,
			},
		];
	}

	if (forges.length > 0) {
		console.log(`Existing forges: ${forges.map((f) => f.name).join(", ")}`);
	}
	const addMoreForges = await promptBool(
		forges.length > 0 ? "Add more forges?" : "Add a forge?",
		forges.length === 0,
	);
	if (addMoreForges || forges.length === 0) {
		forges = await addForge(forges);
	}

	// CIs
	let cis: CiConfig[] = [];
	if (Array.isArray(config.cis)) {
		cis = (config.cis as Record<string, unknown>[]).map(
			(c) => c as unknown as CiConfig,
		);
	} else if (config.ci) {
		const c = config.ci as Record<string, unknown>;
		cis = [
			{
				name: (c.name as string) ?? "default",
				type: (c.type as CiType) ?? "drone",
				url: c.url as string,
				token: c.token as string,
				forge: (c.forge as string) ?? (forges[0]?.name ?? "default"),
			},
		];
	}

	if (cis.length > 0) {
		console.log(`Existing CIs: ${cis.map((c) => c.name).join(", ")}`);
	}
	const addMoreCis = await promptBool(
		cis.length > 0 ? "Add more CIs?" : "Add a CI?",
		cis.length === 0,
	);
	if (addMoreCis || cis.length === 0) {
		cis = await addCi(cis, forges);
	}

	// Beads
	console.log("\n--- Beads ---");
	const beadsDir = await prompt(
		"Repo directory (with .beads/):",
		(config.beads as Record<string, unknown>)?.dir as string ?? ".",
	);
	const beadsBinary = await prompt(
		"bd binary:",
		(config.beads as Record<string, unknown>)?.binary as string ?? "bd",
	);

	// Queue
	console.log("\n--- Queue ---");
	const queueDir = await prompt(
		"Queue directory:",
		(config.queue as Record<string, unknown>)?.dir as string ?? "./queue",
	);

	// Agents
	let agents: AgentConfig[] = [];
	if (Array.isArray(config.agents)) {
		agents = (config.agents as Record<string, unknown>[]).map(
			(a) => a as unknown as AgentConfig,
		);
	}
	if (agents.length > 0) {
		console.log(`Existing agents: ${agents.map((a) => a.name).join(", ")}`);
	}
	const addMoreAgents = await promptBool(
		agents.length > 0 ? "Add more agents?" : "Add an agent?",
		agents.length === 0,
	);
	if (addMoreAgents || agents.length === 0) {
		agents = await addAgent(agents);
	}

	// Webhook
	console.log("\n--- Webhook ---");
	const webhookPort = await promptPort(
		"Port:",
		(config.webhook as Record<string, unknown>)?.port as number ?? 8080,
	);
	const webhookSecret = await prompt(
		"Secret (env var name or value):",
		(config.webhook as Record<string, unknown>)?.secret as string ?? "${WEBHOOK_SECRET:-}",
	);

	// Parser
	console.log("\n--- Parser ---");
	const parserType = await promptSelect(
		"Type:",
		["mention"],
		0,
	);

	// Log
	console.log("\n--- Logging ---");
	const logLevel = await promptSelect(
		"Level:",
		["debug", "info", "warn", "error"],
		1,
	);
	const logFormat = await promptSelect(
		"Format:",
		["text", "json"],
		0,
	);

	rl.close();

	const result: OrchestratorConfig = {
		forges,
		cis,
		beads: { dir: beadsDir, binary: beadsBinary },
		queue: { type: "file" satisfies QueueType, dir: queueDir },
		agents,
		webhook: { port: webhookPort, secret: webhookSecret },
		parser: { type: parserType as ParserType },
		log: {
			level: logLevel as LogLevel,
			format: logFormat as LogFormat,
		},
	};

	// Write the config
	const yaml = stringify(result, { indent: 2 });
	writeFileSync(configPath, yaml);
	console.log(`\nConfig written to ${configPath}`);
	console.log(`\nRun with: bun run src/index.ts ${configPath}`);

	return result;
}

if (import.meta.main) {
	const path = process.argv[2] ?? "config.yaml";
	await runSetup(path);
}