import type {
	ForgeClient,
	ForgeComment,
	ForgePr,
} from "./types.ts";
import type { ForgeConfig } from "../config/types.ts";

/**
 * ForgeClient for Gitea instances.
 * Uses the Gitea REST API with token auth.
 */
export class GiteaClient implements ForgeClient {
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
			`/api/v1/repos/${owner}/${repo}/issues/${number}/comments`,
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
		await this.#request(
			"POST",
			`/api/v1/repos/${_owner}/${_repo}/issues/comments/${commentId}/reactions`,
			{ content: emoji },
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
			`/api/v1/repos/${owner}/${repo}/issues/comments/${commentId}`,
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
			`/api/v1/repos/${owner}/${repo}/pulls/${number}`,
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
			`/api/v1/repos/${owner}/${repo}/issues/${number}/comments`,
		);
		return data.map((c) => ({
			id: Number(c.id),
			author: String((c.user as Record<string, unknown>)?.login ?? ""),
			body: String(c.body ?? ""),
			createdAt: String(c.created_at ?? ""),
			updatedAt: c.updated_at ? String(c.updated_at) : undefined,
		}));
	}

	async #request<T>(
		method: string,
		path: string,
		body?: Record<string, unknown>,
	): Promise<T> {
		const res = await fetch(`${this.#base}${path}`, {
			method,
			headers: {
				Authorization: `token ${this.#token}`,
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(
				`forge API ${method} ${path} failed: ${res.status} ${text}`,
			);
		}
		return (await res.json()) as T;
	}
}