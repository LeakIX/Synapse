import type { Issue } from "../issues/types.ts";
import type { CiStatus } from "../ci/types.ts";

/** Kind of event, determines the payload shape. */
export type EventKind =
	| "comment"
	| "issue"
	| "pr"
	| "beads_change"
	| "ci_status";

/** A canonical event from any source. */
export interface Event {
	/** Unique ID, assigned by the orchestrator on receipt. */
	id: string;
	/** Name of the EventSource that produced this event. */
	source: string;
	/** Name of the forge the event came from, when a forge sent it. */
	forge?: string;
	/** Discriminator for the payload. */
	kind: EventKind;
	/** Type-specific data. */
	payload: EventPayload;
	/** ISO timestamp of when the orchestrator received it. */
	receivedAt: string;
}

/** A new comment on an issue or PR. */
export interface CommentPayload {
	owner: string;
	repo: string;
	/** Issue or PR number the comment is on. */
	number: number;
	/** ID of the comment itself (for reactions). */
	commentId: number;
	/** Username of the comment author. */
	author: string;
	/** Full comment body (markdown). */
	body: string;
	/** Canonical URL of the comment. */
	url: string;
}

/** An issue lifecycle event. */
export interface IssuePayload {
	owner: string;
	repo: string;
	number: number;
	title: string;
	author: string;
	/** What happened to the issue. */
	action: IssueAction;
	url: string;
}

/** A pull request lifecycle event. */
export interface PrPayload {
	owner: string;
	repo: string;
	number: number;
	title: string;
	author: string;
	/** What happened to the PR. */
	action: PrAction;
	url: string;
}

/** A change detected in the beads database. */
export interface BeadsChangePayload {
	/** The beads issue ID that changed. */
	issueId: string;
	/** What kind of change. */
	change: BeadsChange;
	/** The issue after the change, if available. */
	issue?: Issue;
}

/** A CI status change for a PR. */
export interface CiStatusPayload {
	/** The PR number this status applies to. */
	prNumber: number;
	status: CiStatus;
	/** URL to the CI build. */
	url: string;
}

/** Discriminated union of all payload shapes. */
export type EventPayload =
	| CommentPayload
	| IssuePayload
	| PrPayload
	| BeadsChangePayload
	| CiStatusPayload;

export type { Issue } from "../issues/types.ts";
export type { CiStatus } from "../ci/types.ts";

/** What happened to an issue in a forge event. */
export type IssueAction = "opened" | "closed" | "reopened" | "labelled";

/** What happened to a PR in a forge event. */
export type PrAction = "opened" | "closed" | "merged" | "labelled";

/** What kind of change was detected in the beads database. */
export type BeadsChange =
	| "created"
	| "updated"
	| "closed"
	| "dep_added"
	| "dep_removed";