import type { CiClient, CiBuild, CiStatus } from "./types.ts";
import type { CiConfig } from "../config/types.ts";

/**
 * CiClient for GitHub Actions.
 * Uses the GitHub Checks API to check workflow run status.
 */
export class GitHubActionsClient implements CiClient {
	#base: string;
	#token: string;

	constructor(config: CiConfig) {
		this.#base = config.url.replace(/\/$/, "");
		this.#token = config.token;
	}

	async isMerged(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<boolean> {
		const build = await this.getBuild(owner, repo, prNumber);
		return build.status === "passing";
	}

	async getBuild(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<CiBuild> {
		const res = await fetch(
			`${this.#base}/repos/${owner}/${repo}/pulls/${prNumber}/checks`,
			{
				headers: {
					Authorization: `Bearer ${this.#token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);
		if (!res.ok) {
			throw new Error(
				`GitHub Actions API failed: ${res.status} ${await res.text()}`,
			);
		}
		const data = (await res.json()) as {
			check_runs?: Array<{ status: string; conclusion: string | null }>;
		};

		const checks = data.check_runs ?? [];
		if (checks.length === 0) {
			return {
				prNumber,
				status: "pending",
				url: `${this.#base}/${owner}/${repo}/pulls/${prNumber}/checks`,
				startedAt: new Date().toISOString(),
			};
		}

		const allPassing = checks.every(
			(c) => c.conclusion === "success" || c.conclusion === "neutral",
		);
		const anyFailing = checks.some(
			(c) => c.conclusion === "failure" || c.conclusion === "action_required",
		);

		const status: CiStatus = anyFailing
			? "failing"
			: allPassing
				? "passing"
				: "pending";

		return {
			prNumber,
			status,
			url: `${this.#base}/${owner}/${repo}/pulls/${prNumber}/checks`,
			startedAt: new Date().toISOString(),
		};
	}
}