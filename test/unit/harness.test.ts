import { describe, expect, test } from "bun:test";
import { CommandHarness, lastLine } from "../../src/harness/command.ts";
import {
	OpenCodeHarness,
	summarize,
} from "../../src/harness/opencode.ts";

describe("CommandHarness", () => {
	test("a command that succeeds reports the last line", async () => {
		const harness = new CommandHarness({ command: "echo" });
		const result = await harness.run({
			instruction: "hello world",
			taskId: "t1",
		});
		expect(result.status).toBe("success");
		expect(result.summary).toBe("done: hello world");
		expect(result.output).toContain("hello world");
	});

	test("a command that fails reports a failure", async () => {
		const harness = new CommandHarness({ command: "false" });
		const result = await harness.run({ instruction: "x", taskId: "t2" });
		expect(result.status).toBe("failure");
		expect(result.summary).toStartWith("failed:");
	});

	test("the instruction reaches the command as one argument", async () => {
		const harness = new CommandHarness({ command: "printf '%s'" });
		const result = await harness.run({
			instruction: "two words",
			taskId: "t3",
		});
		expect(result.output).toBe("two words");
	});

	test("the harness reports no model, so the agent decides", async () => {
		const harness = new CommandHarness({ command: "echo" });
		const result = await harness.run({ instruction: "x", taskId: "t4" });
		expect(result.model).toBeUndefined();
	});

	test("the harness names itself", () => {
		expect(new CommandHarness({ command: "echo" }).name).toBe("command");
	});
});

describe("lastLine", () => {
	test("takes the last non-empty line", () => {
		expect(lastLine("one\ntwo\n\n")).toBe("two");
	});

	test("is empty for empty output", () => {
		expect(lastLine("   \n\n")).toBe("");
	});

	test("caps the line at 200 characters", () => {
		expect(lastLine("x".repeat(500))).toHaveLength(200);
	});
});

describe("OpenCodeHarness", () => {
	test("builds the non-interactive call", () => {
		const harness = new OpenCodeHarness({
			model: "anthropic/claude-opus-5",
			dir: "/work",
			agent: "build",
		});
		expect(harness.argsFor("fix the test")).toEqual([
			"run",
			"fix the test",
			"--format",
			"json",
			"--model",
			"anthropic/claude-opus-5",
			"--dir",
			"/work",
			"--agent",
			"build",
		]);
	});

	test("leaves out what the config does not set", () => {
		expect(new OpenCodeHarness().argsFor("x")).toEqual([
			"run",
			"x",
			"--format",
			"json",
		]);
	});

	test("names itself", () => {
		expect(new OpenCodeHarness().name).toBe("opencode");
	});

	test("a missing binary is a failure, not a throw", async () => {
		const harness = new OpenCodeHarness({
			binary: "/nonexistent/opencode",
		});
		const result = await harness.run({ instruction: "x", taskId: "t" });
		expect(result.status).toBe("failure");
		expect(result.summary).toStartWith("failed:");
	});
});

describe("summarize", () => {
	test("takes the last text of the JSON events", () => {
		const out = [
			'{"type":"start"}',
			'{"type":"message","parts":[{"type":"text","text":"thinking"}]}',
			'{"type":"message","parts":[{"type":"text","text":"Fixed the test"}]}',
		].join("\n");
		expect(summarize(out)).toBe("Fixed the test");
	});

	test("falls back to the last raw line when nothing parses", () => {
		expect(summarize("plain output\nlast line")).toBe("last line");
	});

	test("is empty when the run printed nothing", () => {
		expect(summarize("")).toBe("");
	});

	test("takes the last line of a multi line text", () => {
		const out = '{"text":"first line\\nsecond line"}';
		expect(summarize(out)).toBe("second line");
	});
});
