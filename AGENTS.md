# AGENTS.md - Guidance for AI Agents

This file contains important information for AI agents working on this codebase.

## Critical Rules

- **Follow ASD-STE100 writing guidelines** for your prose and documentation. Use short, direct sentences. One idea per sentence. Use the present tense. Prefer "use" over "utilize". Prefer "start" over "commence". Prefer "stop" over "terminate". Prefer "show" over "demonstrate". Prefer "help" over "assist". Prefer "need" over "require". Prefer "can" over "is able to". Prefer "must" over "is required to". Avoid jargon. Define terms on first use. Use active voice. The subject performs the action. "The agent claims the task" not "The task is claimed by the agent".
- **NEVER push directly to `main`** - Any change must be done through a patch with a new branch. Create a feature branch, commit your changes, and open a PR.
- **NEVER use `/` in branch names** - Use `-` or `_` as separators instead.
- **NEVER use em dashes or en dashes** in any output. Use commas, semicolons, or separate sentences instead.
- **NEVER use non-ASCII characters** in output. Use only ASCII (0x00-0x7F). No fancy quotes, arrows, or special symbols.
- **Keep PRs small and reviewable.** One branch and one PR per logical unit of work. Each PR must be green and self-contained on its own.
- **Record the model in the commit message and the PR.** When an AI agent authors a change, name the model that wrote it. In the commit message, a trailing line such as `Model: <provider>/<model-id>`. In the PR description, a line such as `Model: [...]` filled with the same value, so both the history and the review say which agent produced the change.
- **Do not reference plan or task numbers in commits, PRs, or the changelog.** No "P12", "task 5b", "plan 0001", or the like. Describe the change by what it does, not by where it sits in a plan.
- **Verify the full CI pipeline is green before considering a branch done.** After pushing or force-pushing, check that every step in the CI pipeline passes. A branch that is not green must not be built upon by another branch.

## Security

- **NEVER add any new dependency or update a dependency** without the explicit consent of the prompt engineer. All dependency changes must be approved first.
- **NEVER commit secrets or keys to the repository.** Tokens and credentials come from environment variables or the gitignored `.env` file.

## Prose Style (ASD-STE100)

The Synapse project follows ASD-STE100 for all prose: commit messages, PR
descriptions, documentation, error messages, and log output.

Rules:
- One idea per sentence.
- Use the present tense: "the agent claims the task".
- Use the active voice: "the queue dispatches the task" not "the task is dispatched".
- Use short words: "use" not "utilize", "start" not "initiate", "stop" not "terminate".
- Use short sentences. Break long sentences into two.
- Define a term on first use, then use the term consistently.
- Do not use jargon without definition.
- Do not use idioms, metaphors, or figures of speech.
- Use "you" for the reader. Do not use "we" or "I".

## Architecture

Synapse is the junction where signals (webhooks) are passed to the brain (agents).

Everything is behind an interface. The orchestrator depends only on
interfaces; concrete implementations are wired in the composition root
(`src/index.ts`).

| Interface | Purpose |
|-----------|---------|
| `EventSource` | Where events come from |
| `EventParser` | Extract instructions from events |
| `IssueTracker` | Create, update, close issues |
| `TaskQueue` | Dispatch work to agents |
| `ForgeClient` | Comment and react on the forge |
| `CiClient` | Check PR merge readiness |
| `Logger` | Log activity |
| `ConfigSource` | Load configuration |

Adding a new backend means adding a new file and one case in the
composition root. The orchestrator never changes.

## Agent Protocol

An agent is a process that claims tasks from the queue, does the work,
and reports the result back.

1. The agent starts and reads its name from the command line or config.
2. The agent reacts with its emoji on the forge comment when it claims a task.
3. The agent executes the instruction in the task.
4. The agent records the model that performed the work in the result.
5. The agent marks the task as complete or failed in the queue.
6. The orchestrator observes the completion and comments on the forge.

The agent must record the model in the task result summary. The format
is `Model: <provider>/<model-id>` on the last line of the summary.
This lets the history and the review say which agent produced the change.