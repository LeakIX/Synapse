import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
	Event,
	CommentPayload,
	IssuePayload,
	PrPayload,
	IssueAction,
	PrAction,
} from "../core/event.ts";
import type { EventSource } from "../events/types.ts";
import type { WebhookConfig, ForgeConfig } from "../config/types.ts";
import type { Logger } from "../log/types.ts";

/**
 * EventSource that receives forge webhooks over one HTTP server.
 *
 * One server serves every configured forge, because a production run
 * exposes one port through one tunnel. The path names the forge:
 *
 *   POST /webhook/<forge-name>
 *
 * A request to any other path reaches the only configured forge, so a
 * setup with a single forge keeps working with a plain "/" hook URL.
 * With two or more forges, an unnamed path is a 404: the source cannot
 * guess which forge sent the payload, and guessing would send the reply
 * to the wrong forge.
 *
 * The event carries the forge name, so the orchestrator answers on the
 * forge the event came from.
 */
export class ForgeWebhookSource implements EventSource {
	readonly name = "forge-webhook";
	#port: number;
	#secret: string;
	#forges: ForgeConfig[];
	#logger?: Logger;
	#server: ReturnType<typeof Bun.serve> | null = null;

	constructor(
		forges: ForgeConfig[],
		webhookConfig: WebhookConfig,
		logger?: Logger,
	) {
		if (forges.length === 0) {
			throw new Error("forge webhook source: at least one forge is required");
		}
		this.#forges = forges;
		this.#port = webhookConfig.port;
		this.#secret = webhookConfig.secret;
		this.#logger = logger;
	}

	/** Path the forge must post to. */
	pathFor(forgeName: string): string {
		return `/webhook/${forgeName}`;
	}

	start(onEvent: (event: Event) => void): () => void {
		const secret = this.#secret;
		const forges = this.#forges;

		if (!secret) {
			// The example config ships an empty secret, so a deployment
			// that copies it verifies nothing. Say so, loudly, once.
			this.#logger?.warn(
				"webhook secret is empty: every payload is accepted unverified",
				{ port: this.#port },
			);
		}

		this.#server = Bun.serve({
			port: this.#port,
			async fetch(req: Request) {
				if (req.method !== "POST") {
					return new Response("Not Found", { status: 404 });
				}

				const path = new URL(req.url).pathname;
				const named = path.match(/^\/webhook\/([^/]+)$/);
				const forge = named
					? forges.find((f) => f.name === named[1])
					: forges.length === 1
						? forges[0]
						: undefined;
				if (!forge) {
					return new Response("Unknown forge", { status: 404 });
				}

				const body = await req.text();

				if (secret) {
					const signature =
						req.headers.get("x-gitea-signature") ??
						req.headers.get("x-hub-signature-256") ??
						"";
					const expected = createHmac("sha256", secret)
						.update(body)
						.digest("hex");
					const provided = signature.replace(/^sha256=/, "");
					if (!digestsMatch(provided, expected)) {
						return new Response("Invalid signature", { status: 401 });
					}
				}
				let payload: Record<string, unknown>;
				try {
					payload = JSON.parse(body);
				} catch {
					return new Response("Invalid JSON", { status: 400 });
				}

				const event = parseWebhookPayload(payload, forge.name);
				if (event) {
					onEvent(event);
				}
				return new Response("OK", { status: 200 });
			},
		});

		return () => {
			this.#server?.stop();
			this.#server = null;
		};
	}
}

/**
 * Compare two hex digests in constant time.
 *
 * A plain string compare stops at the first byte that differs, so the
 * time it takes tells the caller how much of the signature was right.
 * A caller who can measure that learns the signature one byte at a
 * time, without ever knowing the secret. timingSafeEqual always reads
 * every byte.
 *
 * The length check is not constant time, and it does not need to be:
 * the length of a SHA-256 hex digest is public.
 *
 * Exported for testing.
 */
export function digestsMatch(provided: string, expected: string): boolean {
	const a = Buffer.from(provided, "utf-8");
	const b = Buffer.from(expected, "utf-8");
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * Parse a raw webhook payload into a canonical Event.
 * Exported for testing.
 */
export function parseWebhookPayload(
	payload: Record<string, unknown>,
	forge?: string,
): Event | null {
	const action = String(payload.action ?? "");
	// Gitea and GitHub both name the repository "repository". Keep "repo"
	// as a fallback, because a hand-built payload may use the short name.
	const repo = (payload.repository ?? payload.repo) as
		| Record<string, unknown>
		| undefined;
	if (!repo) return null;

	// Gitea calls the owner "username", GitHub calls it "login".
	const repoOwner = repo.owner as Record<string, unknown> | undefined;
	const owner = String(
		repoOwner?.name ?? repoOwner?.login ?? repoOwner?.username ?? "",
	);
	const repoName = String(repo.name ?? "");

	const base = {
		id: randomUUID(),
		source: "forge-webhook",
		forge,
		receivedAt: new Date().toISOString(),
	};

	// Comment events (Gitea: "issue_comment" type, GitHub: "issue_comment")
	const comment = payload.comment as Record<string, unknown> | undefined;
	if (comment) {
		const issueOrPr = (
			payload.pull_request ?? payload.issue
		) as Record<string, unknown> | undefined;
		if (issueOrPr) {
			return {
				...base,
				kind: "comment",
				payload: {
					owner,
					repo: repoName,
					number: Number(issueOrPr.number),
					commentId: Number(comment.id),
					author: String(
						((comment.user as Record<string, unknown>)?.login ??
							""),
					),
					body: String(comment.body ?? ""),
					url: String(comment.html_url ?? ""),
				} satisfies CommentPayload,
			};
		}
	}

	// PR events
	const pr = payload.pull_request as Record<string, unknown> | undefined;
	if (pr) {
		const prAction: PrAction | null =
			action === "opened"
				? "opened"
				: action === "closed"
					? pr.merged
						? "merged"
						: "closed"
					: action === "merged"
						? "merged"
						: action === "labelled" || action === "labeled"
							? "labelled"
							: null;
		if (prAction) {
			return {
				...base,
				kind: "pr",
				payload: {
					owner,
					repo: repoName,
					number: Number(pr.number),
					title: String(pr.title ?? ""),
					author: String(
						((pr.user as Record<string, unknown>)?.login ??
							""),
					),
					action: prAction,
					url: String(pr.html_url ?? ""),
				} satisfies PrPayload,
			};
		}
	}

	// Issue events
	const issue = payload.issue as Record<string, unknown> | undefined;
	if (issue) {
		const issueAction: IssueAction | null =
			action === "opened" || action === "created"
				? "opened"
				: action === "closed" || action === "reopened"
					? action === "reopened"
						? "reopened"
						: "closed"
					: action === "labeled" || action === "labelled"
						? "labelled"
						: null;
		if (issueAction) {
			return {
				...base,
				kind: "issue",
				payload: {
					owner,
					repo: repoName,
					number: Number(issue.number),
					title: String(issue.title ?? ""),
					author: String(
						((issue.user as Record<string, unknown>)?.login ??
							""),
					),
					action: issueAction,
					url: String(issue.html_url ?? ""),
				} satisfies IssuePayload,
			};
		}
	}

	return null;
}