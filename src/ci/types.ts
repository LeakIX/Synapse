/** CI build status. */
export type CiStatus = "pending" | "passing" | "failing";

/** A CI build for a PR. */
export interface CiBuild {
	/** The PR number this build is for. */
	prNumber: number;
	status: CiStatus;
	/** URL to the CI build. */
	url: string;
	/** ISO timestamp of when the build started. */
	startedAt: string;
	/** ISO timestamp of when the build finished, if finished. */
	finishedAt?: string;
}

/**
 * Abstraction over the CI system (Drone, Woodpecker, GitHub Actions, ...).
 * The orchestrator depends on this interface to check PR merge readiness.
 */
export interface CiClient {
	/**
	 * Check if all required CI checks for a PR have passed.
	 * Used to determine if a follow-up PR can be merged.
	 */
	isMerged(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<boolean>;
	/** Fetch the latest CI build status for a PR. */
	getBuild(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<CiBuild>;
}