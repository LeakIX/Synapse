import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YamlConfigSource, expandEnvVars, validateConfig } from "../../src/config/yaml.ts";

describe("expandEnvVars", () => {
	test("replaces ${VAR} with env value", () => {
		process.env.TEST_VAR = "hello";
		expect(expandEnvVars("token: ${TEST_VAR}")).toBe("token: hello");
	});

	test("replaces ${VAR:-default} with default when unset", () => {
		delete process.env.UNSET_VAR;
		expect(expandEnvVars("x: ${UNSET_VAR:-fallback}")).toBe("x: fallback");
	});

	test("replaces ${VAR:-default} with env value when set", () => {
		process.env.SET_VAR = "real";
		expect(expandEnvVars("x: ${SET_VAR:-fallback}")).toBe("x: real");
	});

	test("returns empty string for unset var without default", () => {
		delete process.env.NOPE;
		expect(expandEnvVars("x: ${NOPE}")).toBe("x: ");
	});

	test("handles multiple vars in one string", () => {
		process.env.A = "1";
		process.env.B = "2";
		expect(expandEnvVars("${A}-${B}")).toBe("1-2");
	});

	test("leaves non-var strings alone", () => {
		expect(expandEnvVars("no vars here")).toBe("no vars here");
	});

	test("leaves $ without braces alone", () => {
		expect(expandEnvVars("price: $5")).toBe("price: $5");
	});
});

describe("validateConfig", () => {
	test("validates a complete config", () => {
		const config = validateConfig({
			forge: { type: "gitea", url: "https://git.example.com", token: "t", owner: "o", repo: "r" },
			ci: { type: "drone", url: "https://ci.example.com", token: "ct" },
			beads: { dir: "/tmp/beads", binary: "bd" },
			queue: { type: "file", dir: "/tmp/queue" },
			agents: [{ name: "agent1", emoji: "🤖", capabilities: ["code"] }],
			webhook: { port: 8080, secret: "s3cret" },
			parser: { type: "mention" },
			log: { level: "debug", format: "json" },
		});
		expect(config.forge.type).toBe("gitea");
		expect(config.forge.token).toBe("t");
		expect(config.agents).toHaveLength(1);
		expect(config.agents[0].name).toBe("agent1");
		expect(config.webhook.port).toBe(8080);
		expect(config.log.level).toBe("debug");
	});

	test("throws on missing forge key", () => {
		expect(() => validateConfig({})).toThrow(/forge/);
	});

	test("throws on empty agents array", () => {
		const base = baseConfig();
		base.agents = [];
		expect(() => validateConfig(base)).toThrow(/agents/);
	});

	test("throws on missing agent name", () => {
		const base = baseConfig();
		(base.agents as Record<string, unknown>[])[0] = { emoji: "🤖" };
		expect(() => validateConfig(base)).toThrow(/name/);
	});

	test("throws on missing forge.url", () => {
		const base = baseConfig();
		(base.forge as Record<string, unknown>).url = "";
		expect(() => validateConfig(base)).toThrow(/forge\.url/);
	});

	test("throws on non-numeric webhook port", () => {
		const base = baseConfig();
		(base.webhook as Record<string, unknown>).port = "not-a-number";
		expect(() => validateConfig(base)).toThrow(/webhook\.port/);
	});
});

describe("YamlConfigSource", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cfg-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("loads a valid YAML config", () => {
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forge:
  type: gitea
  url: https://git.example.com
  token: testtoken
  owner: myorg
  repo: myrepo
ci:
  type: drone
  url: https://ci.example.com
  token: citoken
beads:
  dir: /tmp/beads
  binary: bd
queue:
  type: file
  dir: /tmp/queue
agents:
  - name: agent1
    emoji: "🤖"
    capabilities:
      - code
webhook:
  port: 8080
  secret: s3cret
parser:
  type: mention
log:
  level: info
  format: text
`,
		);
		const config = new YamlConfigSource(path).load();
		expect(config.forge.owner).toBe("myorg");
		expect(config.forge.repo).toBe("myrepo");
		expect(config.agents[0].capabilities).toEqual(["code"]);
	});

	test("expands env vars in YAML", () => {
		process.env.MY_TOKEN = "expanded-token";
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forge:
  type: github
  url: https://github.com
  token: \${MY_TOKEN}
  owner: o
  repo: r
ci:
  type: drone
  url: https://ci
  token: x
beads:
  dir: /tmp
  binary: bd
queue:
  type: file
  dir: /tmp/q
agents:
  - name: a
    emoji: "🤖"
    capabilities: []
webhook:
  port: 9090
  secret: s
parser:
  type: mention
log:
  level: info
`,
		);
		const config = new YamlConfigSource(path).load();
		expect(config.forge.token).toBe("expanded-token");
	});

	test("uses default when env var unset", () => {
		delete process.env.UNSET_TOKEN;
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forge:
  type: gitea
  url: https://git
  token: \${UNSET_TOKEN:-default-token}
  owner: o
  repo: r
ci:
  type: drone
  url: https://ci
  token: x
beads:
  dir: /tmp
  binary: bd
queue:
  type: file
  dir: /tmp/q
agents:
  - name: a
    emoji: "🤖"
    capabilities: []
webhook:
  port: 9090
  secret: s
parser:
  type: mention
log:
  level: info
`,
		);
		const config = new YamlConfigSource(path).load();
		expect(config.forge.token).toBe("default-token");
	});

	test("throws on missing file", () => {
		expect(() => new YamlConfigSource(join(dir, "nope.yaml")).load()).toThrow();
	});
});

function baseConfig(): Record<string, unknown> {
	return {
		forge: { type: "gitea", url: "https://git", token: "t", owner: "o", repo: "r" },
		ci: { type: "drone", url: "https://ci", token: "ct" },
		beads: { dir: "/tmp", binary: "bd" },
		queue: { type: "file", dir: "/tmp/q" },
		agents: [{ name: "a", emoji: "🤖", capabilities: [] }],
		webhook: { port: 8080, secret: "s" },
		parser: { type: "mention" },
		log: { level: "info", format: "text" },
	};
}