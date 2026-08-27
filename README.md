# Synapse

The junction where signals (webhooks) are passed to the brain (agents).

Event-driven agent task orchestrator. Listens for forge webhooks and beads changes, parses agent mentions, creates beads issues, dispatches work via a pluggable queue, and reports back to both the forge and beads.

## Architecture

Everything is behind an interface. The orchestrator depends only on interfaces; concrete implementations are wired in the composition root (`src/index.ts`).

| Interface | Purpose | Concrete Impls |
|-----------|---------|----------------|
| `EventSource` | Where events come from | `ForgeWebhookSource`, `BeadsWatchSource` |
| `EventParser` | Extract instructions from events | `MentionParser` |
| `IssueTracker` | Create/update/close issues | `BeadsClient` |
| `TaskQueue` | Dispatch work to agents | `FileQueue`, `MemoryQueue` |
| `ForgeClient` | Comment/react on the forge | `GiteaClient`, `GitHubClient` |
| `CiClient` | Check PR merge readiness | `DroneClient`, `WoodpeckerClient`, `GitHubActionsClient` |
| `Logger` | Log activity | `StdoutLogger` |
| `ConfigSource` | Load configuration | `YamlConfigSource` |

Adding a new backend = new file + one case in the composition root. The orchestrator never changes.

## Flow

```
Forge Webhook          Beads Watch
      |                     |
      v                     v
   EventSource  --------->  EventSource
      |                     |
      +----------+----------+
                 |
                 v
           EventParser (MentionParser)
                 |
                 v
           Orchestrator.handleEvent()
                 |
         +-------+-------+
         |               |
         v               v
   IssueTracker      TaskQueue
   (BeadsClient)    (FileQueue)
         |               |
         |               v
         |          Agent claims task
         |               |
         |               v
         |          Agent completes/fails
         |               |
         +-------+-------+
                 |
                 v
           ForgeClient (comment back)
           IssueTracker (close/update)
```

1. Human comments on a forge issue/PR: `@code-agent fix the failing test`
2. `ForgeWebhookSource` receives the webhook, normalizes to `Event`
3. `MentionParser` extracts the agent name, instruction, urgency, follow-up PR
4. `Orchestrator` creates a beads issue, publishes a task to the queue
5. Agent claims the task, does the work, completes it
6. `Orchestrator` watches for completion, comments back on the forge, closes the beads issue

## Quick Start

```bash
# Install
bun install

# Configure
cp config.example.yaml config.yaml
# Edit config.yaml with your forge/CI/beads settings

# Run
bun run src/index.ts config.yaml
```

## Configuration

See `config.example.yaml` for a fully annotated example. All `${VAR}` references are expanded from environment variables. Use `${VAR:-default}` for optional values.

```yaml
forges:
  - name: primary
    type: gitea
    url: https://git.example.com
    token: ${GITEA_TOKEN}
    owner: myorg
    repo: myrepo

cis:
  - name: primary
    type: drone
    url: https://ci.example.com
    token: ${CI_TOKEN}
    forge: primary

beads:
  dir: /path/to/repo
  binary: bd

queue:
  type: file
  dir: ./queue

agents:
  - name: code-agent
    emoji: "🔧"

webhook:
  port: 8080
  secret: ${WEBHOOK_SECRET:-}

parser:
  type: mention

log:
  level: info
  format: text
```

## Tests

Three tiers, all run with `bun test`:

```bash
bun test              # all tests
bun test test/unit/   # unit tests (each module in isolation)
bun test test/integration/  # integration (multiple real modules, mocked boundary)
bun test test/e2e/    # e2e (full in-process system, real HTTP)
bun run typecheck     # tsc --noEmit
```

| Tier | What | Mocks |
|------|------|-------|
| Unit | Each module in isolation | All deps mocked |
| Integration | Multiple real modules together | Outer boundary mocked (forge HTTP, bd CLI) |
| E2E | Full in-process system | Forge + tracker mocked, everything else real |

## Viewer

Web interface showing the dependency graph with agent assignments and queue state.

```bash
bun run src/viewer/server.ts --port 8090 --dir /path/to/repo
```

Open http://localhost:8090

The viewer shows:
- Force-directed dependency graph from `bd list --json`
- Agent color-coding (which agent works on what)
- Queue state overlay (pending/active/done/failed)
- Filter by status, agent, or search
- Click a node for details, double-click to open the panel

## Project Structure

```
src/
  index.ts          # Composition root (only file importing concrete classes)
  config/
    types.ts        # OrchestratorConfig and sub-configs
    source.ts       # ConfigSource interface
    yaml.ts         # YamlConfigSource (YAML + env expansion)
  core/
    event.ts        # Event types (CommentPayload, PrPayload, etc.)
    orchestrator.ts # The orchestrator
    ci-gate.ts      # CI gating for follow-up tasks
  events/
    types.ts        # EventSource interface
    forge-webhook.ts # HTTP webhook receiver
    beads-watch.ts   # Filesystem watcher for .beads/
  parser/
    types.ts        # EventParser interface
    mention.ts      # @agent-name parser
  issues/
    types.ts        # IssueTracker interface
    beads.ts        # bd CLI client
  queue/
    types.ts        # TaskQueue interface
    file.ts         # File-based queue (JSON)
    memory.ts       # In-memory queue (tests)
  forge/
    types.ts        # ForgeClient interface
    gitea.ts        # Gitea REST API
    github.ts       # GitHub REST API
  ci/
    types.ts        # CiClient interface
    drone.ts        # Drone API
    woodpecker.ts   # Woodpecker API
    github-actions.ts # GitHub Checks API
  log/
    types.ts        # Logger interface
    stdout.ts       # StdoutLogger (text + JSON)
  viewer/
    index.html      # Web UI (force-directed graph)
    server.ts       # Viewer HTTP server
test/
  unit/             # 12 test files
  integration/      # 2 test files
  e2e/              # 1 test file
  helpers/          # Mock forge, mock tracker, fake bd
```

## License

See [LICENSE](LICENSE).