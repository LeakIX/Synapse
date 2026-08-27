import type { CiClient } from "../ci/types.ts";
import type { QueueTask } from "../queue/types.ts";
import type { Logger } from "../log/types.ts";

/**
 * Gates task dispatch on CI status for follow-up tasks.
 *
 * When a task has a followUpAfter (PR number), the CI gate checks
 * whether that PR's CI has passed before allowing the task to proceed.
 * If CI is still pending or failing, the task is held.
 */
export class CiGate {
	#ci: CiClient;
	#logger: Logger;
	#owner: string;
	#repo: string;

	constructor(
		ci: CiClient,
		logger: Logger,
		owner: string,
		repo: string,
	) {
		this.#ci = ci;
		this.#logger = logger;
		this.#owner = owner;
		this.#repo = repo;
	}

	/**
	 * Check if a task is ready to dispatch.
	 * Returns true if the task has no followUpAfter, or if the
	 * follow-up PR's CI has passed.
	 */
	async isReady(task: QueueTask): Promise<boolean> {
		if (task.followUpAfter === undefined) {
			return true;
		}

		try {
			const passed = await this.#ci.isMerged(
				this.#owner,
				this.#repo,
				task.followUpAfter,
			);
			if (passed) {
				this.#logger.info("CI gate: PR passed, dispatching", {
					pr: task.followUpAfter,
					taskId: task.id,
				});
				return true;
			}
			this.#logger.info("CI gate: PR not yet passing, holding task", {
				pr: task.followUpAfter,
				taskId: task.id,
			});
			return false;
		} catch (err) {
			this.#logger.warn("CI gate: check failed, holding task", {
				pr: task.followUpAfter,
				taskId: task.id,
				error: String(err),
			});
			return false;
		}
	}
}