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
  "create create"|"create ")
    ;;
esac
# Handle single-command forms (bd create, bd update, etc.)
first="$1"
case "$first" in
  "create")
    title="$2"
    shift 2
    while [ $# -gt 0 ]; do
      case "$1" in
        --description|--type|--priority|--external-ref|--labels) shift ;;
        --json) ;;
        -*) ;;
        *) title="$1" ;;
      esac
      shift
    done
    echo '{"id":"test-abc.1","title":"'"$title"'","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}'
    ;;
  "update")
    id="$2"
    echo '{"id":"'"$id"'","title":"updated","description":"","status":"in_progress","priority":1,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}'
    ;;
  "close")
    echo "closed $2"
    ;;
  "show")
    id="$2"
    echo '{"id":"'"$id"'","title":"shown","description":"desc","status":"open","priority":3,"type":"task","labels":["x"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}'
    ;;
  "list")
    echo '[{"id":"test-abc.1","title":"one","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"},{"id":"test-abc.2","title":"two","description":"","status":"closed","priority":1,"type":"task","labels":["done"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}]'
    ;;
  "link")
    echo "linked"
    ;;
  "dep")
    sub="$2"
    case "$sub" in
      "add") echo "dep added" ;;
      "remove") echo "dep removed" ;;
      *) echo "unknown dep subcommand" >&2; exit 1 ;;
    esac
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