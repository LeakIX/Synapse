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
2. `ForgeWebhookSource` receives the webhook on `/webhook/<forge-name>`
   and normalizes it to an `Event` that carries the forge name
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
  # harness: opencode (default) or command
  - name: code-agent
    emoji: "🔧"
    harness: opencode
    model: anthropic/claude-opus-5

webhook:
  # Point each forge at /webhook/<forge-name>.
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

The frontend is a SvelteKit application. It uses Svelte 5 runes, TypeScript, Tailwind v4 and the LeakIX brand tokens. It builds to static files with `adapter-static`, and the Bun server hands them out.

```bash
# Build the frontend once
bun run viewer:build

# Run the viewer
bun run src/viewer/server.ts --port 8090 --dir /path/to/repo
```

Open http://localhost:8090

The server sends the built frontend when `src/viewer/web/build` exists. It falls back to the single file page in `src/viewer/index.html` when it does not, so the viewer runs before you build.

To work on the frontend, run the viewer on port 8090 and start the Vite dev server. Vite proxies `/api` to the viewer, so you develop against real data.

```bash
bun run viewer:dev     # Vite dev server with hot reload
bun run viewer:check   # svelte-check type checking
```

The viewer shows:
- Force-directed dependency graph from `bd list --json`
- Agent color-coding (which agent works on what)
- Queue state overlay (pending/active/done/failed)
- Filter by status, agent, or search
- Click a node to select it, press Enter or double-click to open the panel
- Explicit loading, empty and error states

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
  harness/
    types.ts        # AgentHarness interface
    opencode.ts     # OpenCode CLI harness (default)
    command.ts      # shell command harness
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
    index.html      # Fallback single file page
    server.ts       # Viewer HTTP server
    web/            # SvelteKit frontend (Svelte 5 + Tailwind v4)
      src/app.css   # Tailwind entry and the LeakIX @theme tokens
      src/lib/      # Domain modules and components
      src/routes/   # The viewer page
test/
  unit/             # 12 test files
  integration/      # 2 test files
  e2e/              # 1 test file
  helpers/          # Mock forge, mock tracker, fake bd
```

## Artificial Intelligence Contribution Disclosure

This project was developed with the assistance of AI models for code generation, review, and documentation. All code has been reviewed and validated by human developers.

Patches written with the help of LLMs contain a disclaimer in the body of the commits.

## License

See [LICENSE](LICENSE).
