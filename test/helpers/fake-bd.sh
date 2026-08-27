#!/bin/sh
# fake bd for testing
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
    printf '{"id":"test-abc.1","title":"%s","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}\n' "$title"
    ;;
  "update")
    id="$2"
    printf '{"id":"%s","title":"updated","description":"","status":"in_progress","priority":1,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}\n' "$id"
    ;;
  "close")
    printf 'closed %s\n' "$2"
    ;;
  "show")
    id="$2"
    printf '{"id":"%s","title":"shown","description":"desc","status":"open","priority":3,"type":"task","labels":["x"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}\n' "$id"
    ;;
  "list")
    printf '[{"id":"test-abc.1","title":"one","description":"","status":"open","priority":2,"type":"task","labels":[],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"},{"id":"test-abc.2","title":"two","description":"","status":"closed","priority":1,"type":"task","labels":["done"],"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}]\n'
    ;;
  "link")
    printf 'linked\n'
    ;;
  "dep")
    sub="$2"
    case "$sub" in
      "add") printf 'dep added\n' ;;
      "remove") printf 'dep removed\n' ;;
      *) printf 'unknown dep subcommand\n' >&2; exit 1 ;;
    esac
    ;;
  *)
    printf 'unknown command: %s\n' "$*" >&2
    exit 1
    ;;
esac