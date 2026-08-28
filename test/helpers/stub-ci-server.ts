import type { CiConfig } from "../../src/config/types.ts";

/** Build status the stub server reports, in Drone's own words. */
export type StubBuildStatus = "pending" | "running" | "passed" | "failed";

/**
 * A real HTTP server that speaks the Drone build API.
 *
 * Use it to drive a real DroneClient over the network, instead of
 * replacing the client with an in-memory mock. Set `status` to move the
 * build from failing to passing while the test runs, which is what the
 * CI gate waits for.
 *
 * Route:
 *   GET /api/repos/<owner>/<repo>/builds
 *
 * Every other route returns 404. When you set a token, a request
 * without the matching authorization header gets 401.
 *
 * Usage:
 *   const ci = new StubCiServer({ token: "ci-token" });
 *   ci.start();
 *   const client = new DroneClient(ci.ciConfig("drone", "primary"));
 *   ci.status = "passed";
 *   ci.stop();
 */
export class StubCiServer {
	#server: ReturnType<typeof Bun.serve> | null = null;
	#port: number;
	#token: string;

	/** Status the next build report carries. */
	status: StubBuildStatus;
	/** Paths the server received, oldest first. */
	requests: string[] = [];

	constructor(opts?: {
		/** Token the server demands. Empty means no check. */
		token?: string;
		/** Port to listen on. Default 0, which picks a free port. */
		port?: number;
		/** Status the server starts with. Default "failed". */
		status?: StubBuildStatus;
	}) {
		this.#token = opts?.token ?? "";
		this.#port = opts?.port ?? 0;
		this.status = opts?.status ?? "failed";
	}

	/** Start listening. Call stop() when the test ends. */
	start(): void {
		this.#server = Bun.serve({
			port: this.#port,
			fetch: (req: Request) => this.#handle(req),
		});
		this.#port = this.#server.port ?? this.#port;
	}

	/** Stop listening. Safe to call twice. */
	stop(): void {
		this.#server?.stop(true);
		this.#server = null;
	}

	/** Port the server listens on. Valid after start(). */
	get port(): number {
		return this.#port;
	}

	/** Base URL of the server. Valid after start(). */
	get url(): string {
		return `http://localhost:${this.#port}`;
	}

	/** How many build reports the server served. */
	get buildRequestCount(): number {
		return this.requests.filter((p) => p.endsWith("/builds")).length;
	}

	/** A CiConfig pointing at this server, for building a real client. */
	ciConfig(name: string, forge: string): CiConfig {
		return {
			name,
			type: "drone",
			url: this.url,
			token: this.#token,
			forge,
		};
	}

	#handle(req: Request): Response {
		const path = new URL(req.url).pathname;
		this.requests.push(path);

		if (this.#token) {
			const auth = req.headers.get("authorization") ?? "";
			if (auth !== `Bearer ${this.#token}`) {
				return Response.json({ message: "unauthorized" }, { status: 401 });
			}
		}

		if (!/^\/api\/repos\/[^/]+\/[^/]+\/builds$/.test(path)) {
			return Response.json({ message: "not found" }, { status: 404 });
		}

		return Response.json([
			{
				number: 1,
				status: this.status,
				link: `${this.url}/build/1`,
				started: Date.now(),
			},
		]);
	}
}
