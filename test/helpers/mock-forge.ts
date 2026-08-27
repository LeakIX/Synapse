import type { ForgeClient, ForgeComment, ForgePr } from "../../src/forge/types.ts";

/**
 * In-memory ForgeClient for tests.
 * Records all comments and reactions for assertions.
 */
export class MockForge implements ForgeClient {
	comments: Array<{
		owner: string;
		repo: string;
		number: number;
		body: string;
	}> = [];
	reactions: Array<{
		owner: string;
		repo: string;
		issueOrPrNumber: number;
		commentId: number;
		emoji: string;
	}> = [];

	async comment(
		owner: string,
		repo: string,
		number: number,
		body: string,
	): Promise<void> {
		this.comments.push({ owner, repo, number, body });
	}

	async react(
		owner: string,
		repo: string,
		issueOrPrNumber: number,
		commentId: number,
		emoji: string,
	): Promise<void> {
		this.reactions.push({ owner, repo, issueOrPrNumber, commentId, emoji });
	}

	async getComment(
		_owner: string,
		_repo: string,
		_issueOrPrNumber: number,
		_commentId: number,
	): Promise<ForgeComment> {
		throw new Error("not implemented in mock");
	}

	async getPr(
		_owner: string,
		_repo: string,
		_number: number,
	): Promise<ForgePr> {
		throw new Error("not implemented in mock");
	}

	async listComments(
		_owner: string,
		_repo: string,
		_number: number,
	): Promise<ForgeComment[]> {
		return [];
	}
}