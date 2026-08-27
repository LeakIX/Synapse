import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	YamlConfigSource,
	expandEnvVars,
	validateConfig,
} from "../../src/config/yaml.ts";

describe("expandEnvVars", () => {
	test("replaces ${VAR} with env value", () => {
		process.env.TEST_VAR = "hello";
		expect(expandEnvVars("token: ${TEST_VAR}")).toBe("token: hello");
	});

	test("replaces ${VAR:-default} with default when unset", () => {
		delete process.env.UNSET_VAR;
		expect(expandEnvVars("x: ${UNSET_VAR:-fallback}")).toBe(
			"x: fallback",
		);
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
	test("validates a complete config with forges array", () => {
		const config = validateConfig({
			forges: [
				{
					name: "f1",
					type: "gitea",
					url: "https://git.example.com",
					token: "t",
					owner: "o",
					repo: "r",
				},
			],
			cis: [
				{
					name: "c1",
					type: "drone",
					url: "https://ci.example.com",
					token: "ct",
					forge: "f1",
				},
			],
			beads: { dir: "/tmp/beads", binary: "bd" },
			queue: { type: "file", dir: "/tmp/queue" },
			agents: [
				{ name: "agent1", emoji: "🤖", capabilities: ["code"] },
			],
			webhook: { port: 8080, secret: "s3cret" },
			parser: { type: "mention" },
			log: { level: "debug", format: "json" },
		});
		expect(config.forges).toHaveLength(1);
		expect(config.forges[0].name).toBe("f1");
		expect(config.forges[0].type).toBe("gitea");
		expect(config.cis).toHaveLength(1);
		expect(config.cis[0].forge).toBe("f1");
		expect(config.agents).toHaveLength(1);
		expect(config.webhook.port).toBe(8080);
	});

	test("accepts singular forge key for backward compat", () => {
		const config = validateConfig({
			forge: {
				type: "gitea",
				url: "https://git.example.com",
				token: "t",
				owner: "o",
				repo: "r",
			},
			ci: {
				type: "drone",
				url: "https://ci.example.com",
				token: "ct",
				forge: "default",
			},
			beads: { dir: "/tmp/beads", binary: "bd" },
			queue: { type: "file", dir: "/tmp/queue" },
			agents: [
				{ name: "agent1", emoji: "🤖", capabilities: ["code"] },
			],
			webhook: { port: 8080, secret: "s3cret" },
			parser: { type: "mention" },
			log: { level: "debug", format: "json" },
		});
		expect(config.forges).toHaveLength(1);
		expect(config.forges[0].name).toBe("forge-1");
		expect(config.cis).toHaveLength(1);
		expect(config.cis[0].forge).toBe("default");
	});

	test("accepts multiple forges", () => {
		const config = validateConfig({
			forges: [
				{
					name: "primary",
					type: "gitea",
					url: "https://git1",
					token: "t1",
					owner: "o1",
					repo: "r1",
				},
				{
					name: "secondary",
					type: "github",
					url: "https://git2",
					token: "t2",
					owner: "o2",
					repo: "r2",
				},
			],
			cis: [
				{
					name: "c1",
					type: "drone",
					url: "https://ci1",
					token: "ct1",
					forge: "primary",
				},
				{
					name: "c2",
					type: "github-actions",
					url: "https://ci2",
					token: "ct2",
					forge: "secondary",
				},
			],
			beads: { dir: "/tmp/beads", binary: "bd" },
			queue: { type: "file", dir: "/tmp/queue" },
			agents: [
				{ name: "agent1", emoji: "🤖", capabilities: ["code"] },
			],
			webhook: { port: 8080, secret: "s3cret" },
			parser: { type: "mention" },
			log: { level: "debug", format: "json" },
		});
		expect(config.forges).toHaveLength(2);
		expect(config.forges[0].name).toBe("primary");
		expect(config.forges[1].name).toBe("secondary");
		expect(config.cis).toHaveLength(2);
		expect(config.cis[0].forge).toBe("primary");
		expect(config.cis[1].forge).toBe("secondary");
	});

	test("throws on missing forges key", () => {
		expect(() => validateConfig({})).toThrow(/forges/);
	});

	test("throws on empty forges array", () => {
		const base = baseConfig();
		base.forges = [];
		expect(() => validateConfig(base)).toThrow(/forges/);
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

	test("throws on missing forge url", () => {
		const base = baseConfig();
		(base.forges as Record<string, unknown>[])[0].url = "";
		expect(() => validateConfig(base)).toThrow(/url/);
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

	test("loads a valid YAML config with forges array", () => {
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forges:
  - name: primary
    type: gitea
    url: https://git.example.com
    token: testtoken
    owner: myorg
    repo: myrepo
cis:
  - name: drone
    type: drone
    url: https://ci.example.com
    token: citoken
    forge: primary
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
		expect(config.forges).toHaveLength(1);
		expect(config.forges[0].owner).toBe("myorg");
		expect(config.forges[0].repo).toBe("myrepo");
		expect(config.cis[0].forge).toBe("primary");
		expect(config.agents[0].capabilities).toEqual(["code"]);
	});

	test("expands env vars in YAML", () => {
		process.env.MY_TOKEN = "expanded-token";
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forges:
  - name: main
    type: github
    url: https://github.com
    token: \${MY_TOKEN}
    owner: o
    repo: r
cis: []
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
		expect(config.forges[0].token).toBe("expanded-token");
	});

	test("uses default when env var unset", () => {
		delete process.env.UNSET_TOKEN;
		const path = join(dir, "config.yaml");
		writeFileSync(
			path,
			`
forges:
  - name: main
    type: gitea
    url: https://git
    token: \${UNSET_TOKEN:-default-token}
    owner: o
    repo: r
cis: []
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
		expect(config.forges[0].token).toBe("default-token");
	});

	test("throws on missing file", () => {
		expect(
			() => new YamlConfigSource(join(dir, "nope.yaml")).load(),
		).toThrow();
	});
});

function baseConfig(): Record<string, unknown> {
	return {
		forges: [
			{
				name: "default",
				type: "gitea",
				url: "https://git",
				token: "t",
				owner: "o",
				repo: "r",
			},
		],
		cis: [
			{
				name: "c1",
				type: "drone",
				url: "https://ci",
				token: "ct",
				forge: "default",
			},
		],
		beads: { dir: "/tmp", binary: "bd" },
		queue: { type: "file", dir: "/tmp/q" },
		agents: [{ name: "a", emoji: "🤖", capabilities: [] }],
		webhook: { port: 8080, secret: "s" },
		parser: { type: "mention" },
		log: { level: "info", format: "text" },
	};
}