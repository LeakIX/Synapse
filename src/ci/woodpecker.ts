import type { CiClient, CiBuild, CiStatus } from "./types.ts";
import type { CiConfig } from "../config/types.ts";

/**
 * CiClient for Woodpecker CI.
 * Uses the Woodpecker API to check build status.
 */
export class WoodpeckerClient implements CiClient {
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
			`${this.#base}/api/repos/${owner}/${repo}/builds`,
			{
				headers: { Authorization: `Bearer ${this.#token}` },
			},
		);
		if (!res.ok) {
			throw new Error(
				`Woodpecker API failed: ${res.status} ${await res.text()}`,
			);
		}
		const builds = (await res.json()) as Record<string, unknown>[];
		const build = builds[0];
		if (!build) {
			return {
				prNumber,
				status: "pending",
				url: `${this.#base}/${owner}/${repo}`,
				startedAt: new Date().toISOString(),
			};
		}
		const status = this.#mapStatus(String(build.status ?? "pending"));
		return {
			prNumber,
			status,
			url: String(build.link ?? `${this.#base}/${owner}/${repo}`),
			startedAt: new Date(
				Number((build as Record<string, unknown>).started ?? Date.now()),
			).toISOString(),
			finishedAt: (build as Record<string, unknown>).finished
				? new Date(
						Number((build as Record<string, unknown>).finished),
					).toISOString()
				: undefined,
		};
	}

	#mapStatus(status: string): CiStatus {
		switch (status) {
			case "passed":
				return "passing";
			case "failed":
			case "error":
				return "failing";
			default:
				return "pending";
		}
	}
}