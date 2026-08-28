import type { ForgeConfig } from "../../src/config/types.ts";
import type { GiteaApiVersion } from "../../src/forge/gitea.ts";

/** A comment held by the stub server. */
export interface StubComment {
	id: number;
	author: string;
	body: string;
	createdAt: string;
	updatedAt?: string;
}

/** A reaction recorded by the stub server. */
export interface StubReaction {
	commentId: number;
	content: string;
}

/** A pull request served by the stub server. */
export interface StubPr {
	number: number;
	title: string;
	headRef: string;
	baseRef: string;
	merged: boolean;
	createdAt: string;
	mergedAt?: string;
	url: string;
}

/** One request the stub server received. */
export interface StubRequest {
	method: string;
	path: string;
	authorization: string;
	body: string;
}

/**
 * A real HTTP server that speaks the Gitea REST API.
 *
 * Use it to drive the real GiteaClient over the network in a test,
 * instead of replacing the client with an in-memory mock. The server
 * keeps state, so a comment you post is a comment you can read back.
 *
 * Routes:
 *   POST /api/<v>/repos/<owner>/<repo>/issues/<number>/comments
 *   GET  /api/<v>/repos/<owner>/<repo>/issues/<number>/comments
 *   GET  /api/<v>/repos/<owner>/<repo>/issues/comments/<id>
 *   POST /api/<v>/repos/<owner>/<repo>/issues/comments/<id>/reactions
 *   GET  /api/<v>/repos/<owner>/<repo>/pulls/<number>
 *
 * Every other route returns 404. When you set a token, a request
 * without the matching "Authorization: token <token>" header gets 401.
 *
 * Usage:
 *   const forge = new StubForgeServer({ token: "t" });
 *   forge.start();
 *   const client = new GiteaClient(forge.forgeConfig("org", "repo"));
 *   await client.comment("org", "repo", 42, "hello");
 *   forge.commentsFor("org", "repo", 42); // [{ body: "hello", ... }]
 *   forge.stop();
 */
export class StubForgeServer {
	/** Every request the server received, in order. */
	requests: StubRequest[] = [];
	/** Every reaction the server received, in order. */
	reactions: StubReaction[] = [];

	#server: ReturnType<typeof Bun.serve> | null = null;
	#port: number;
	#token: string;
	#apiVersion: GiteaApiVersion;
	#nextId: number;
	/** Comments per thread, keyed by "<owner>/<repo>#<number>". */
	#comments = new Map<string, StubComment[]>();
	/** Thread key per comment id, so a comment id resolves to its thread. */
	#threadOf = new Map<number, string>();
	/** Pull requests, keyed by "<owner>/<repo>#<number>". */
	#prs = new Map<string, StubPr>();

	constructor(opts?: {
		/** Token the server demands. Empty string accepts any request. */
		token?: string;
		/** API version segment the routes use. Default "v1". */
		apiVersion?: GiteaApiVersion;
		/** Port to listen on. Default 0, which picks a free port. */
		port?: number;
		/** First comment id the server hands out. Default 1000. */
		firstCommentId?: number;
	}) {
		this.#token = opts?.token ?? "";
		this.#apiVersion = opts?.apiVersion ?? "v1";
		this.#port = opts?.port ?? 0;
		this.#nextId = opts?.firstCommentId ?? 1000;
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

	/** A ForgeConfig pointing at this server, for building a real client. */
	forgeConfig(owner: string, repo: string): ForgeConfig {
		return {
			name: "stub",
			type: "gitea",
			url: this.url,
			token: this.#token,
			owner,
			repo,
			apiVersion: this.#apiVersion,
		};
	}

	/** Add a comment without going through the API. Returns the comment. */
	seedComment(
		owner: string,
		repo: string,
		number: number,
		comment: { author: string; body: string },
	): StubComment {
		return this.#addComment(this.#key(owner, repo, number), comment);
	}

	/** Add a pull request the server serves on GET. */
	seedPr(
		owner: string,
		repo: string,
		pr: Omit<StubPr, "url"> & { url?: string },
	): StubPr {
		const stored: StubPr = {
			...pr,
			url: pr.url ?? `${this.url}/${owner}/${repo}/pulls/${pr.number}`,
		};
		this.#prs.set(this.#key(owner, repo, pr.number), stored);
		return stored;
	}

	/** Comments on one issue or PR, oldest first. */
	commentsFor(owner: string, repo: string, number: number): StubComment[] {
		return this.#comments.get(this.#key(owner, repo, number)) ?? [];
	}

	/** Reactions recorded for one comment. */
	reactionsFor(commentId: number): StubReaction[] {
		return this.reactions.filter((r) => r.commentId === commentId);
	}

	/** Forget all state, including recorded requests. */
	reset(): void {
		this.requests = [];
		this.reactions = [];
		this.#comments.clear();
		this.#threadOf.clear();
		this.#prs.clear();
	}

	async #handle(req: Request): Promise<Response> {
		const path = new URL(req.url).pathname;
		const body = await req.text();
		this.requests.push({
			method: req.method,
			path,
			authorization: req.headers.get("authorization") ?? "",
			body,
		});

		if (this.#token) {
			const auth = req.headers.get("authorization") ?? "";
			if (auth !== `token ${this.#token}`) {
				return Response.json({ message: "unauthorized" }, { status: 401 });
			}
		}

		const v = this.#apiVersion;
		const prefix = `/api/${v}/repos/`;
		if (!path.startsWith(prefix)) return this.#notFound();
		const rest = path.slice(prefix.length);

		// <owner>/<repo>/issues/comments/<id>/reactions
		let m = rest.match(/^([^/]+)\/([^/]+)\/issues\/comments\/(\d+)\/reactions$/);
		if (m && req.method === "POST") {
			const commentId = Number(m[3]);
			if (!this.#threadOf.has(commentId)) return this.#notFound();
			const content = String(this.#json(body).content ?? "");
			this.reactions.push({ commentId, content });
			return Response.json({ id: commentId, content });
		}

		// <owner>/<repo>/issues/comments/<id>
		m = rest.match(/^([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/);
		if (m && req.method === "GET") {
			const comment = this.#findComment(Number(m[3]));
			if (!comment) return this.#notFound();
			return Response.json(this.#renderComment(comment));
		}

		// <owner>/<repo>/issues/<number>/comments
		m = rest.match(/^([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/);
		if (m) {
			const key = this.#key(m[1]!, m[2]!, Number(m[3]));
			if (req.method === "GET") {
				const all = this.#comments.get(key) ?? [];
				return Response.json(all.map((c) => this.#renderComment(c)));
			}
			if (req.method === "POST") {
				const created = this.#addComment(key, {
					author: "synapse",
					body: String(this.#json(body).body ?? ""),
				});
				return Response.json(this.#renderComment(created), { status: 201 });
			}
		}

		// <owner>/<repo>/pulls/<number>
		m = rest.match(/^([^/]+)\/([^/]+)\/pulls\/(\d+)$/);
		if (m && req.method === "GET") {
			const pr = this.#prs.get(this.#key(m[1]!, m[2]!, Number(m[3])));
			if (!pr) return this.#notFound();
			return Response.json({
				number: pr.number,
				title: pr.title,
				head: { ref: pr.headRef },
				base: { ref: pr.baseRef },
				merged: pr.merged,
				created_at: pr.createdAt,
				merged_at: pr.mergedAt,
				html_url: pr.url,
			});
		}

		return this.#notFound();
	}

	#addComment(
		key: string,
		comment: { author: string; body: string },
	): StubComment {
		const stored: StubComment = {
			id: this.#nextId++,
			author: comment.author,
			body: comment.body,
			createdAt: new Date().toISOString(),
		};
		const thread = this.#comments.get(key) ?? [];
		thread.push(stored);
		this.#comments.set(key, thread);
		this.#threadOf.set(stored.id, key);
		return stored;
	}

	#findComment(id: number): StubComment | undefined {
		const key = this.#threadOf.get(id);
		if (!key) return undefined;
		return this.#comments.get(key)?.find((c) => c.id === id);
	}

	#renderComment(c: StubComment): Record<string, unknown> {
		return {
			id: c.id,
			user: { login: c.author },
			body: c.body,
			created_at: c.createdAt,
			updated_at: c.updatedAt,
			html_url: `${this.url}/comments/${c.id}`,
		};
	}

	#json(body: string): Record<string, unknown> {
		try {
			return JSON.parse(body) as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	#notFound(): Response {
		return Response.json({ message: "not found" }, { status: 404 });
	}

	#key(owner: string, repo: string, number: number): string {
		return `${owner}/${repo}#${number}`;
	}
}
