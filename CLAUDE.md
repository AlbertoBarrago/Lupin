# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Lupin is a repo-aware local coding agent CLI backed by Ollama. The only runnable code lives in `lupin-core/`. Everything else at the root is documentation.

## Running

```bash
cd lupin-core
npm run start
# or directly:
node lupin-core/src/index.mjs
```

Requires a running Ollama instance:

```bash
ollama serve
ollama pull qwen2.5-coder:7b   # default model
```

Non-interactive single task:

```bash
node lupin-core/src/index.mjs --task "describe the repo"
```

Target a different project root:

```bash
node lupin-core/src/index.mjs --project-root /path/to/project
```

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model name |
| `OLLAMA_TIMEOUT_MS` | `20000` | Request timeout |
| `AGENT_MAX_STEPS` | `30` | Max tool-use steps per task |
| `AGENT_MAX_HISTORY` | `16` | Messages kept in session history |
| `AGENT_DENY_DANGEROUS_BASH` | `1` | Block risky shell commands |
| `AGENT_PROJECT_ROOT` | cwd | Override project root |
| `DEBUG` | `0` | Enable debug output |

## Architecture

```
lupin-core/src/
  index.mjs            — CLI entry: arg parsing, REPL loop, slash commands, mode dispatch
  config.mjs           — loadConfig(): merges env vars + CLI flags into one config object
  core/
    queryEngine.mjs    — QueryEngine: agentic loop (tool calls → final answer), workflow guards
    toolRuntime.mjs    — ToolRuntime: tool registry, policy enforcement, execution
    workspaceContext.mjs — detects git root, markers, README summary, instruction files
    workspaceInit.mjs  — /init logic: generates LUPIN.md from workspace snapshot
    jsonProtocol.mjs   — JSON extraction/validation for model output
    permissions.mjs    — BashTool policy: blocks dangerous commands
    fsSafety.mjs       — path traversal guards for file tools
  model/
    ollamaAdapter.mjs  — OllamaAdapter: wraps Ollama chat API
  prompt/
    systemPrompt.mjs   — builds the system prompt injected into every task
  tools/               — BashTool, FileReadTool, FileEditTool, FileWriteTool, GlobTool, GrepTool
  storage/
    sessionStore.mjs   — persists chat + tool history per session to disk
```

### Agentic loop (QueryEngine)

`runTask()` drives a step loop up to `maxSteps`. Each step:
1. Calls `modelAdapter.chat()` expecting JSON output
2. Parses with `jsonProtocol.mjs` — expects `{type:"tool_call", tool, args}` or `{type:"final", content}`
3. On tool call: runs via `ToolRuntime.execute()`, appends result as next user message
4. Enforces workflow guards: implementation tasks must inspect before editing, and verify after editing, or the loop pushes back with `WORKFLOW_ERROR`

### Mode dispatch (index.mjs)

- `code` (default): all non-command input runs through `QueryEngine.runTask()`
- `chat`: uses `runChatReply()` — straight model chat, no tool loop
- `auto`: routes by `detectCodingIntent()` keyword heuristic

### Workspace context

Built once at startup by `workspaceContext.mjs`. Detects git root, framework markers (package.json, pyproject.toml, etc.), README summary, and any instruction files (LUPIN.md, CLAUDE.md, .cursorrules). Injected into every system prompt and used by `/init`.

## Owner preferences

- Treat as experienced engineer (15+ years). Skip beginner explanations.
- Prefer clean, pragmatic code. No abstraction theater.
- Be direct. If something is weak, say so with the technical reason.
- Mirror language: Italian or English depending on what the user uses.
- Inspect files before making claims about implementation.
