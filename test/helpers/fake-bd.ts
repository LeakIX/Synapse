import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BeadsClient } from "../../src/issues/beads.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Creates a fake bd executable that responds to bd CLI commands with JSON.
 * Returns { dir, client, cleanup } where dir is a temp directory.
 */
export function createFakeBd() {
	const dir = mkdtempSync(join(tmpdir(), "fake-bd-"));
	const bdPath = join(dir, "fake-bd");

	const script = readFileSync(join(__dirname, "fake-bd.sh"), "utf-8");
	writeFileSync(bdPath, script, { mode: 0o755 });
	const client = new BeadsClient(dir, bdPath);

	return {
		dir,
		client,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}