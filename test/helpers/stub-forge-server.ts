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
 * A real HTTP server that speaks a forge REST API.
 *
 * Use it to drive a real ForgeClient over the network in a test, instead
 * of replacing the client with an in-memory mock. The server keeps
 * state, so a comment you post is a comment you can read back.
 *
 * This class holds the state and the routes, which Gitea and GitHub
 * share. A subclass supplies the three things they do not share: the
 * path prefix, the authorization header, and the client config. Use
 * StubGiteaServer or StubGitHubServer; you cannot build this class.
 *
 * Routes, after the prefix the subclass gives:
 *   POST <prefix><owner>/<repo>/issues/<number>/comments
 *   GET  <prefix><owner>/<repo>/issues/<number>/comments
 *   GET  <prefix><owner>/<repo>/issues/comments/<id>
 *   POST <prefix><owner>/<repo>/issues/comments/<id>/reactions
 *   GET  <prefix><owner>/<repo>/pulls/<number>
 *
 * Every other route returns 404. When you set a token, a request
 * without the matching authorization header gets 401.
 *
 * Usage:
 *   const forge = new StubGiteaServer({ token: "t" });
 *   forge.start();
 *   const client = new GiteaClient(forge.forgeConfig("org", "repo"));
 *   await client.comment("org", "repo", 42, "hello");
 *   forge.commentsFor("org", "repo", 42); // [{ body: "hello", ... }]
 *   forge.stop();
 */
export abstract class StubForgeServer {
	/** Every request the server received, in order. */
	requests: StubRequest[] = [];
	/** Every reaction the server received, in order. */
	reactions: StubReaction[] = [];

	#server: ReturnType<typeof Bun.serve> | null = null;
	#port: number;
	#token: string;
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
		/** Port to listen on. Default 0, which picks a free port. */
		port?: number;
		/** First comment id the server hands out. Default 1000. */
		firstCommentId?: number;
	}) {
		this.#token = opts?.token ?? "";
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

	/** Token the server demands, for a subclass that builds a config. */
	protected get token(): string {
		return this.#token;
	}

	/** A ForgeConfig pointing at this server, for building a real client. */
	abstract forgeConfig(owner: string, repo: string): ForgeConfig;

	/** Path every route starts with, up to and including "repos/". */
	protected abstract routePrefix(): string;

	/** Authorization header value the server accepts for this token. */
	protected abstract authorization(token: string): string;

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
			if (auth !== this.authorization(this.#token)) {
				return Response.json({ message: "unauthorized" }, { status: 401 });
			}
		}

		const prefix = this.routePrefix();
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

/**
 * Stub server that speaks the Gitea REST API.
 *
 * Gitea puts the API under /api/<version>/repos/ and takes a token in
 * the form "token <token>".
 */
export class StubGiteaServer extends StubForgeServer {
	#apiVersion: GiteaApiVersion;

	constructor(opts?: {
		token?: string;
		/** API version segment the routes use. Default "v1". */
		apiVersion?: GiteaApiVersion;
		port?: number;
		firstCommentId?: number;
	}) {
		super(opts);
		this.#apiVersion = opts?.apiVersion ?? "v1";
	}

	forgeConfig(owner: string, repo: string): ForgeConfig {
		return {
			name: "stub-gitea",
			type: "gitea",
			url: this.url,
			token: this.token,
			owner,
			repo,
			apiVersion: this.#apiVersion,
		};
	}

	protected routePrefix(): string {
		return `/api/${this.#apiVersion}/repos/`;
	}

	protected authorization(token: string): string {
		return `token ${token}`;
	}
}

/**
 * Stub server that speaks the GitHub REST API.
 *
 * GitHub puts the API at the root, under /repos/, and takes a token in
 * the form "Bearer <token>".
 */
export class StubGitHubServer extends StubForgeServer {
	forgeConfig(owner: string, repo: string): ForgeConfig {
		return {
			name: "stub-github",
			type: "github",
			url: this.url,
			token: this.token,
			owner,
			repo,
		};
	}

	protected routePrefix(): string {
		return "/repos/";
	}

	protected authorization(token: string): string {
		return `Bearer ${token}`;
	}
}
