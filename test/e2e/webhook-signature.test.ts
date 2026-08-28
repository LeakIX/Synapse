import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { createHmac } from "node:crypto";
import { ForgeWebhookSource } from "../../src/events/forge-webhook.ts";
import { StubGiteaServer } from "../helpers/stub-forge-server.ts";
import type { Event } from "../../src/core/event.ts";
import type { CommentPayload } from "../../src/core/event.ts";

const owner = "org";
const repo = "repo";
const secret = "a-real-webhook-secret";

// E2E test: a signed webhook over real HTTP.
// Real: ForgeWebhookSource (HTTP server), HMAC signing on the caller
//       side, both header names the forges use
//
// The signature check is the only thing between the internet and an
// agent that runs code. Prove it over the socket, not in a unit test
// that calls the compare directly.

describe("E2E: the webhook checks the signature", () => {
	let forge: StubGiteaServer;
	let source: ForgeWebhookSource;
	let events: Event[];
	let stop: () => void;
	const port = 19985;

	/** The payload every case in this file posts. */
	function payload(body: string): string {
		return JSON.stringify({
			action: "created",
			repository: { name: repo, owner: { login: owner } },
			issue: { number: 42, user: { login: "human" } },
			comment: { id: 900, body, user: { login: "human" } },
		});
	}

	/** The signature a forge sends for this body. */
	function sign(body: string): string {
		return createHmac("sha256", secret).update(body).digest("hex");
	}

	function post(body: string, headers: Record<string, string>) {
		return fetch(`http://localhost:${port}/`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body,
		});
	}

	beforeAll(() => {
		forge = new StubGiteaServer({ token: "token" });
		forge.start();
		events = [];
		source = new ForgeWebhookSource(
			[{ ...forge.forgeConfig(owner, repo), name: "gitea" }],
			{ port, secret },
		);
		stop = source.start((e) => events.push(e));
	});

	afterAll(() => {
		stop();
		forge.stop();
	});

	test("a Gitea signature is accepted", async () => {
		const body = payload("@code-agent fix the failing test");
		const res = await post(body, { "x-gitea-signature": sign(body) });

		expect(res.status).toBe(200);
		expect(events).toHaveLength(1);
		expect((events[0]!.payload as CommentPayload).number).toBe(42);
	});

	test("a GitHub sha256= signature is accepted", async () => {
		events.length = 0;
		const body = payload("@code-agent run the tests");
		const res = await post(body, {
			"x-hub-signature-256": `sha256=${sign(body)}`,
		});

		expect(res.status).toBe(200);
		expect(events).toHaveLength(1);
	});

	test("a signature for another body is rejected", async () => {
		events.length = 0;
		const body = payload("@code-agent do the work");
		const res = await post(body, {
			"x-gitea-signature": sign(payload("a different body")),
		});

		expect(res.status).toBe(401);
		expect(events).toHaveLength(0);
	});

	test("a signature of the wrong length is rejected", async () => {
		events.length = 0;
		const body = payload("@code-agent do the work");
		const res = await post(body, { "x-gitea-signature": "abc123" });

		expect(res.status).toBe(401);
		expect(events).toHaveLength(0);
	});

	test("a missing signature is rejected", async () => {
		events.length = 0;
		const body = payload("@code-agent do the work");
		const res = await post(body, {});

		expect(res.status).toBe(401);
		expect(events).toHaveLength(0);
	});

	test("the body reaches the handler unchanged, so the signature covers it", async () => {
		events.length = 0;
		// A payload with unicode and a quote, to catch a body that is
		// re-encoded between the signature check and the parser.
		const body = payload('@code-agent fix the "cafe" test éè');
		const res = await post(body, { "x-gitea-signature": sign(body) });

		expect(res.status).toBe(200);
		const cp = events[0]!.payload as CommentPayload;
		expect(cp.body).toBe('@code-agent fix the "cafe" test éè');
	});
});
