# Lupin

Local coding-agent scaffold with a sharper personal identity and Claude Code-inspired workflow.

This is not a full clone of proprietary runtime parts. It is a practical restore path:
- model adapter
- tool registry
- permission policy
- recursive query + tool loop
- CLI entrypoint

## What it includes

- `src/model/ollamaAdapter.mjs`: local Ollama chat adapter
- `src/core/queryEngine.mjs`: JSON protocol loop (`tool_call` and `final`)
- `src/core/toolRuntime.mjs`: tool execution and policy gate
- `src/core/permissions.mjs`: risk classification and dangerous-command blocks
- `src/tools/*`: `BashTool`, `FileReadTool`, `FileWriteTool`, `GlobTool`, `GrepTool`
- `src/storage/sessionStore.mjs`: local session persistence
- `src/index.mjs`: interactive CLI

## Run

From repository root:

```bash
node restore-core/src/index.mjs
```

Or from `restore-core/`:

```bash
npm run start
```

To point the agent at a different codebase explicitly:

```bash
node restore-core/src/index.mjs --project-root /absolute/path/to/project
```

To install the CLI in your shell and run it from other project roots:

```bash
cd restore-core
npm link
cd /absolute/path/to/project
lupin --project-root /absolute/path/to/project
```

If you are already inside the target project root, the zsh-friendly form is:

```bash
lupin --project-root "$PWD"
```

## Ollama setup

In another terminal:

```bash
ollama serve
ollama pull llama3.2
```

Then in the agent:

- `/health`
- `/init` to create a workspace-local `LUPIN.md`
- `/context` to inspect the current repo context Lupin is using
- `/model qwen2.5-coder:7b` (optional)
- `/mode code` (default)
- `/code inspect this repository and list key entry files`
You can also use mixed behavior:

- `/mode chat` for normal assistant replies
- `/mode auto` to choose chat vs code by intent
- `/ask <prompt>` for direct chat reply without tool loop
Direct inspection commands (no planner required):

- `/files [regex]`
- `/read <path>`
- `/grep <pattern> [--path <path>]`
- `/bash <command>`

`/init` analyzes the current workspace, stores a local snapshot for that workspace, and writes or refreshes `LUPIN.md` so future sessions start with project-specific instructions. Manual `## Owner Preferences` content is preserved across reruns.

## Environment variables

- `OLLAMA_BASE_URL` default: `http://127.0.0.1:11434`
- `OLLAMA_MODEL` default: `llama3.2`
- `OLLAMA_TIMEOUT_MS` default: `20000`
- `AGENT_PROJECT_ROOT` default: current repo root
- `AGENT_MAX_STEPS` default: `30`
- `AGENT_MAX_HISTORY` default: `16`
- `AGENT_MODE` default: `code` (`code`, `chat`, or `auto`)
- `AGENT_DENY_DANGEROUS_BASH` default: `1`

## Notes

- `LUPIN.md` is the workspace instruction file used by `/init`.
- This scaffold keeps data local in `restore-core/.data/workspaces/<hash>.json`.
- Session history is now isolated per workspace root, so switching project does not leak old repo context.
- No external cloud service is required; only local Ollama endpoint is used.
- `restore-core` is still available as a compatibility alias, but `lupin` is the intended CLI identity.
