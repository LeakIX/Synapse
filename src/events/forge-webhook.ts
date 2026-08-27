import { createHmac, randomUUID } from "node:crypto";
import type {
	Event,
	CommentPayload,
	IssuePayload,
	PrPayload,
} from "../core/event.ts";
import type { EventSource } from "../events/types.ts";
import type { WebhookConfig, ForgeConfig } from "../config/types.ts";

/**
 * EventSource that receives forge webhooks via an HTTP server.
 *
 * Handles Gitea and GitHub webhook payloads, normalizing them
 * into canonical Event objects.
 */
export class ForgeWebhookSource implements EventSource {
	readonly name = "forge-webhook";
	#port: number;
	#secret: string;
	#server: ReturnType<typeof Bun.serve> | null = null;

	constructor(_forgeConfig: ForgeConfig, webhookConfig: WebhookConfig) {
		this.#port = webhookConfig.port;
		this.#secret = webhookConfig.secret;
	}

	start(onEvent: (event: Event) => void): () => void {
		const secret = this.#secret;

		this.#server = Bun.serve({
			port: this.#port,
			async fetch(req: Request) {
				if (req.method !== "POST") {
					return new Response("Not Found", { status: 404 });
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
					if (provided !== expected) {
						return new Response("Invalid signature", { status: 401 });
					}
				}
				let payload: Record<string, unknown>;
				try {
					payload = JSON.parse(body);
				} catch {
					return new Response("Invalid JSON", { status: 400 });
				}

				const event = parseWebhookPayload(payload);
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
 * Parse a raw webhook payload into a canonical Event.
 * Exported for testing.
 */
export function parseWebhookPayload(
	payload: Record<string, unknown>,
): Event | null {
	const action = String(payload.action ?? "");
	const repo = payload.repo as Record<string, unknown> | undefined;
	if (!repo) return null;

	const owner = String(
		(repo.owner as Record<string, unknown>)?.name ??
			(repo.owner as Record<string, unknown>)?.login ??
			"",
	);
	const repoName = String(repo.name ?? "");

	const base = {
		id: randomUUID(),
		source: "forge-webhook",
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
		const prAction =
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
		const issueAction =
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