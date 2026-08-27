import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BeadsClient } from "../../src/issues/beads.ts";

/**
 * Creates a fake bd executable that responds to bd CLI commands with JSON.
 * Returns { dir, client, cleanup } where dir is a temp directory.
 */
export function createFakeBd() {
	const dir = mkdtempSync(join(tmpdir(), "fake-bd-"));
	const bdPath = join(dir, "fake-bd");

	const script = `#!/bin/sh
# fake bd for testing
cmd="$1 $2"
case "$cmd" in
  "issue create")
    shift
    title=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --description|--type|--priority|--parent|--external-ref|--label) shift ;;
        --json) ;;
        -*) ;;
        *) title="$1" ;;
      esac
      shift
    done
    echo '{"id":"test-abc.1","title":"'"$title"'","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}'
    ;;
  "issue update")
    id="$3"
    echo '{"id":"'"$id"'","title":"updated","description":"","status":"in_progress","priority":1,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}'
    ;;
  "issue close")
    echo "closed $3"
    ;;
  "issue show")
    id="$3"
    echo '{"id":"'"$id"'","title":"shown","description":"desc","status":"open","priority":3,"type":"task","labels":["x"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}'
    ;;
  "issue list")
    echo '[{"id":"test-abc.1","title":"one","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"},{"id":"test-abc.2","title":"two","description":"","status":"closed","priority":1,"type":"task","labels":["done"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}]'
    ;;
  "dep add")
    echo "dep added"
    ;;
  "dep remove")
    echo "dep removed"
    ;;
  *)
    echo "unknown command: $*" >&2
    exit 1
    ;;
esac
`;

	writeFileSync(bdPath, script, { mode: 0o755 });
	const client = new BeadsClient(dir, bdPath);

	return {
		dir,
		client,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}