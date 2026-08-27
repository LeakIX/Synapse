import { describe, expect, test } from "bun:test";
import { StdoutLogger } from "../../src/log/stdout.ts";

describe("StdoutLogger", () => {
	test("logs at configured level and above", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("warn", "text");
		logger.debug("should not appear");
		logger.info("should not appear");
		logger.warn("should appear");
		logger.error("should appear");

		console.log = original;
		expect(logs).toHaveLength(2);
		expect(logs[0]).toContain("WARN");
		expect(logs[1]).toContain("ERROR");
	});

	test("debug level shows everything", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("debug", "text");
		logger.debug("d");
		logger.info("i");
		logger.warn("w");
		logger.error("e");

		console.log = original;
		expect(logs).toHaveLength(4);
	});

	test("text format includes timestamp and level", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("info", "text");
		logger.info("hello");

		console.log = original;
		expect(logs[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*\[INFO\] hello$/);
	});

	test("text format includes meta", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("info", "text");
		logger.info("hello", { key: "value" });

		console.log = original;
		expect(logs[0]).toContain('"key":"value"');
	});

	test("json format outputs valid JSON", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("info", "json");
		logger.info("hello", { foo: "bar" });

		console.log = original;
		const parsed = JSON.parse(logs[0]);
		expect(parsed.level).toBe("info");
		expect(parsed.msg).toBe("hello");
		expect(parsed.foo).toBe("bar");
		expect(parsed.ts).toBeDefined();
	});

	test("json format omits meta when not provided", () => {
		const logs: string[] = [];
		const original = console.log;
		console.log = (msg: string) => logs.push(msg);

		const logger = new StdoutLogger("info", "json");
		logger.info("simple");

		console.log = original;
		const parsed = JSON.parse(logs[0]);
		expect(parsed.level).toBe("info");
		expect(parsed.msg).toBe("simple");
		expect(parsed).not.toHaveProperty("extra");
	});
});