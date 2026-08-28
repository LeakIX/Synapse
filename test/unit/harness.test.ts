import { describe, expect, test } from "bun:test";
import { CommandHarness, lastLine } from "../../src/harness/command.ts";

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
