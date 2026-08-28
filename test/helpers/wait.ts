/**
 * Poll a condition until it holds or the deadline passes.
 *
 * Use this instead of a fixed sleep. A fixed sleep is either too short,
 * and the test is flaky, or too long, and the suite is slow.
 *
 * @param check   Returns true when the wait is over.
 * @param opts    timeoutMs: give up after this long. Default 2000.
 *                intervalMs: time between checks. Default 10.
 *                label: name shown in the timeout error.
 */
export async function waitFor(
	check: () => boolean | Promise<boolean>,
	opts?: { timeoutMs?: number; intervalMs?: number; label?: string },
): Promise<void> {
	const timeoutMs = opts?.timeoutMs ?? 2000;
	const intervalMs = opts?.intervalMs ?? 10;
	const label = opts?.label ?? "condition";
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		if (await check()) return;
		if (Date.now() >= deadline) {
			throw new Error(`waitFor: ${label} did not hold within ${timeoutMs}ms`);
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}
