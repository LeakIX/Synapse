import type {
	ForgeClient,
	ForgeComment,
	ForgePr,
} from "./types.ts";
import type { ForgeConfig } from "../config/types.ts";

/**
 * ForgeClient for GitHub.
 * Uses the GitHub REST API with token auth.
 */
export class GitHubClient implements ForgeClient {
	#base: string;
	#token: string;

	constructor(config: ForgeConfig) {
		this.#base = config.url.replace(/\/$/, "");
		this.#token = config.token;
	}

	async comment(
		owner: string,
		repo: string,
		number: number,
		body: string,
	): Promise<void> {
		await this.#request(
			"POST",
			`/repos/${owner}/${repo}/issues/${number}/comments`,
			{ body },
		);
	}

	async react(
		_owner: string,
		_repo: string,
		_issueOrPrNumber: number,
		commentId: number,
		emoji: string,
	): Promise<void> {
		const reaction = this.#mapEmoji(emoji);
		await this.#request(
			"POST",
			`/repos/${_owner}/${_repo}/issues/comments/${commentId}/reactions`,
			{ content: reaction },
		);
	}

	async getComment(
		owner: string,
		repo: string,
		_issueOrPrNumber: number,
		commentId: number,
	): Promise<ForgeComment> {
		const data = await this.#request<Record<string, unknown>>(
			"GET",
			`/repos/${owner}/${repo}/issues/comments/${commentId}`,
		);
		return {
			id: Number(data.id),
			author: String((data.user as Record<string, unknown>)?.login ?? ""),
			body: String(data.body ?? ""),
			createdAt: String(data.created_at ?? ""),
			updatedAt: data.updated_at ? String(data.updated_at) : undefined,
		};
	}

	async getPr(
		owner: string,
		repo: string,
		number: number,
	): Promise<ForgePr> {
		const data = await this.#request<Record<string, unknown>>(
			"GET",
			`/repos/${owner}/${repo}/pulls/${number}`,
		);
		return {
			number: Number(data.number),
			title: String(data.title ?? ""),
			headRef: String((data.head as Record<string, unknown>)?.ref ?? ""),
			baseRef: String((data.base as Record<string, unknown>)?.ref ?? ""),
			merged: Boolean(data.merged),
			createdAt: String(data.created_at ?? ""),
			mergedAt: data.merged_at ? String(data.merged_at) : undefined,
			url: String(data.html_url ?? ""),
		};
	}

	async listComments(
		owner: string,
		repo: string,
		number: number,
	): Promise<ForgeComment[]> {
		const data = await this.#request<Record<string, unknown>[]>(
			"GET",
			`/repos/${owner}/${repo}/issues/${number}/comments`,
		);
		return data.map((c) => ({
			id: Number(c.id),
			author: String((c.user as Record<string, unknown>)?.login ?? ""),
			body: String(c.body ?? ""),
			createdAt: String(c.created_at ?? ""),
			updatedAt: c.updated_at ? String(c.updated_at) : undefined,
		}));
	}

	#mapEmoji(emoji: string): string {
		// Map common agent emojis to GitHub reaction content
		const map: Record<string, string> = {
			"👍": "+1",
			"👎": "-1",
			"😄": "laugh",
			"🎉": "hooray",
			"🚀": "rocket",
			"👀": "eyes",
			"🔥": "heart",
			"🔧": "rocket",
			"🧪": "eyes",
		};
		return map[emoji] ?? "rocket";
	}

	async #request<T>(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<T> {
		const res = await fetch(`${this.#base}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.#token}`,
				"Content-Type": "application/json",
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(
				`GitHub API ${method} ${path} failed: ${res.status} ${text}`,
			);
		}
		return (await res.json()) as T;
	}
}