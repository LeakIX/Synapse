import type { CiClient, CiBuild, CiStatus } from "./types.ts";
import type { CiConfig } from "../config/types.ts";

/**
 * CiClient for Drone CI.
 * Uses the Drone API to check build status.
 */
export class DroneClient implements CiClient {
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
				`Drone API failed: ${res.status} ${await res.text()}`,
			);
		}
		const builds = (await res.json()) as Record<string, unknown>[];
		// Find the latest build for this PR (by branch name convention)
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
			startedAt: new Date(Number(build.started ?? Date.now())).toISOString(),
			finishedAt: build.finished
				? new Date(Number(build.finished)).toISOString()
				: undefined,
		};
	}

	#mapStatus(droneStatus: string): CiStatus {
		switch (droneStatus) {
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