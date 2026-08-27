/**
 * Abstraction over the code hosting forge (Gitea, GitHub, GitLab, ...).
 * The orchestrator depends on this interface for all forge interactions.
 */
export interface ForgeClient {
	/** Post a comment on an issue or PR. */
	comment(
		owner: string,
		repo: string,
		number: number,
		body: string,
	): Promise<void>;
	/** Add a reaction (emoji) to a comment. */
	react(
		owner: string,
		repo: string,
		issueOrPrNumber: number,
		commentId: number,
		emoji: string,
	): Promise<void>;
	/** Fetch a single comment by ID. */
	getComment(
		owner: string,
		repo: string,
		issueOrPrNumber: number,
		commentId: number,
	): Promise<ForgeComment>;
	/** Fetch a PR (includes merge state, head ref, etc.). */
	getPr(
		owner: string,
		repo: string,
		number: number,
	): Promise<ForgePr>;
	/** Fetch all comments on an issue or PR. */
	listComments(
		owner: string,
		repo: string,
		number: number,
	): Promise<ForgeComment[]>;
}

/** A comment on an issue or PR, as seen from the forge. */
export interface ForgeComment {
	id: number;
	/** Username of the author. */
	author: string;
	/** Comment body (markdown). */
	body: string;
	/** ISO timestamp of when the comment was created. */
	createdAt: string;
	/** ISO timestamp of last update, if applicable. */
	updatedAt?: string;
}

/** A pull request, as seen from the forge. */
export interface ForgePr {
	number: number;
	title: string;
	/** Branch the PR is from. */
	headRef: string;
	/** Branch the PR targets. */
	baseRef: string;
	/** Whether the PR has been merged. */
	merged: boolean;
	/** ISO timestamp of when the PR was created. */
	createdAt: string;
	/** ISO timestamp of when the PR was merged, if merged. */
	mergedAt?: string;
	/** URL to the PR. */
	url: string;
}