# Lupin

A repo-aware local coding agent CLI backed by Ollama. Runs entirely on local infrastructure — no cloud API keys required.

The only runnable code lives in `lupin-core/`. Everything else at the root is documentation and configuration.

---

## Repository layout

```
lupin-core/src/
  index.mjs                   CLI entry: arg parsing, REPL loop, slash commands, mode dispatch
  config.mjs                  loadConfig(): merges env vars + CLI flags into one config object
  core/
    queryEngine.mjs           Agentic loop (tool calls → final answer), workflow guards
    toolRuntime.mjs           Tool registry, policy enforcement, execution + bash redirect table
    workspaceContext.mjs      Detects git root, framework markers, README summary, instruction files
    workspaceInit.mjs         /init logic: generates LUPIN.md from workspace snapshot
    jsonProtocol.mjs          JSON extraction/validation for model output
    permissions.mjs           BashTool policy: blocks dangerous commands
    fsSafety.mjs              Path traversal guards for file tools
  model/
    ollamaAdapter.mjs         Wraps Ollama chat API
  prompt/
    systemPrompt.mjs          Builds system prompt injected into every task
  tools/
    BashTool.mjs
    FileReadTool.mjs
    FileBatchReadTool.mjs
    FileEditTool.mjs          Three edit modes: LINE-RANGE, TEXT-MATCH, UNIFIED-DIFF
    FileWriteTool.mjs
    FileDeleteTool.mjs
    GlobTool.mjs
    GrepTool.mjs
    WebSearchTool.mjs
    WebFetchTool.mjs
  storage/
    sessionStore.mjs          Persists chat + tool history per session to disk

CLAUDE.md                     Agent instruction file (read by coding agents working in this repo)
TODO.md                       Current product direction and known gaps
package.json                  Root scripts pointing into lupin-core
```

---

## Requirements

- Node.js (ESM, `.mjs` — no build step)
- [Ollama](https://ollama.com) running locally

```bash
ollama serve
ollama pull qwen2.5-coder:7b   # default model
```

---

## Running

From the repo root:

```bash
npm run start
# or directly:
node lupin-core/src/index.mjs
```

Non-interactive single task:

```bash
node lupin-core/src/index.mjs --task "describe the repo"
```

Target a different project root:

```bash
node lupin-core/src/index.mjs --project-root /path/to/project
```

Debug output:

```bash
npm run start:debug
# equivalent: DEBUG=1 node lupin-core/src/index.mjs
```

---

## Environment variables

| Variable | Default | Effect |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Model name |
| `OLLAMA_TIMEOUT_MS` | `20000` | Request timeout (ms) |
| `AGENT_MAX_STEPS` | `30` | Max tool-use steps per task |
| `AGENT_MAX_HISTORY` | `16` | Messages kept in session history |
| `AGENT_DENY_DANGEROUS_BASH` | `1` | Block risky shell commands |
| `AGENT_PROJECT_ROOT` | cwd | Override project root |
| `DEBUG` | `0` | Enable debug output |

---

## Architecture

### Agentic loop (`QueryEngine`)

`runTask()` drives a step loop up to `maxSteps`. Each step:

1. Calls `modelAdapter.chat()` expecting JSON output
2. Parses with `jsonProtocol.mjs` — expects `{type:"tool_call", tool, args}` or `{type:"final", content}`
3. On tool call: runs via `ToolRuntime.execute()`, appends result as next user message
4. Enforces workflow guards: implementation tasks must inspect before editing, and verify after editing — violations push back a `WORKFLOW_ERROR`

`ToolRuntime` also transparently redirects common bash-as-read patterns (`cat`, `ls`, `find -name`, `grep`) to their native tool equivalents before touching the shell.

### Mode dispatch (`index.mjs`)

| Mode | Behaviour |
|---|---|
| `code` (default) | All non-command input runs through `QueryEngine.runTask()` with full tool loop |
| `chat` | Straight model chat via `runChatReply()` — no tool loop |
| `auto` | Routes by `detectCodingIntent()` keyword heuristic |

Switch at runtime: `/mode <code|chat|auto>`

### Workspace context (`workspaceContext.mjs`)

Built once at startup. Detects:
- Git root
- Framework markers (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.)
- README summary
- Instruction files (`LUPIN.md`, `CLAUDE.md`, `.cursorrules`)

Injected into every system prompt and consumed by `/init` when generating `LUPIN.md`.

---

## Slash commands

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/init` | Generate `LUPIN.md` from a workspace snapshot |
| `/refresh` | Rebuild workspace context |
| `/model <name>` | Switch Ollama model mid-session |
| `/mode <code\|chat\|auto>` | Switch agent mode |
| `/read <path>` | Read a file directly |
| `/find <glob>` | Run a glob search |
| `/grep <pattern> [path]` | Run a grep search |
| `/bash <command>` | Run a shell command |
| `/status` | Show current config and context state |
| `/clear` | Clear session history |
| `/exit` | Quit |

---

## `FileEditTool` edit modes

Three modes selected automatically based on model-provided args:

- **LINE-RANGE** — replace lines `start`–`end` with new content; requires a prior `FileReadTool` call to get accurate line numbers
- **TEXT-MATCH** — replace exact `oldText` with `newText`; fails if match is not unique
- **UNIFIED-DIFF** — apply a standard `@@ hunk @@` patch; hunks applied in reverse order with fuzzy context-line matching to tolerate stale line numbers

---

## Session storage

Sessions are persisted under `lupin-core/.data/` (gitignored). `sessionStore.mjs` writes chat and tool call history per session.