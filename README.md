# Lupin

Lupin is a repo-aware coding agent CLI with a stronger engineering workflow, local project memory, tool-driven code editing, and optional web-assisted research when the task actually needs it.

This repository is currently a source tree and working fork, not a polished package release. The main CLI implementation lives in the root TypeScript codebase, and `restore-core/` contains a smaller runnable local scaffold built around Ollama.

## What is in this repo

- `main.tsx`, `commands/`, `components/`, `services/`, `tools/`: main Lupin application source
- `constants/`, `utils/`, `state/`, `screens/`: runtime behavior, prompting, UI state, and terminal flows
- `restore-core/`: lean local agent scaffold with its own `package.json` and `lupin` bin
- `LUPIN.md`: workspace memory and owner preferences for coding agents working in this repo
- `TODO.md`: current product direction and missing pieces

## Current status

- Identity is being reworked around `Lupin` rather than upstream Claude Code naming
- Core editing flow has already been improved with anchored `insert_before` / `insert_after` support
- Web search and web fetch tools exist and are now favored more explicitly when the task requires external or time-sensitive information
- The repo still contains legacy upstream compatibility paths and internal naming that should be cleaned carefully rather than blindly removed

## Practical entry points

If you want to inspect or modify the main app, start from:

- `main.tsx`
- `tools/`
- `services/`
- `constants/prompts.ts`
- `constants/system.ts`

If you want a smaller local runnable scaffold, start from:

- `restore-core/src/index.mjs`
- `restore-core/src/core/queryEngine.mjs`
- `restore-core/src/tools/`

## Running something today

The repository root does not currently ship a root `package.json`, so the top-level app is not presented here as a one-command install.

The runnable path that exists in-tree today is `restore-core/`:

```bash
cd restore-core
npm run start
```

Or directly:

```bash
node restore-core/src/index.mjs
```

That scaffold uses a local Ollama endpoint by default.

## Recommended cleanup direction

- keep the main app source tree intact unless references prove a module is dead
- remove user-facing legacy Claude branding wherever it does not represent a real compatibility dependency
- trim tracked local artifacts, stale docs, and generated runtime state
- improve onboarding so Lupin can infer repo shape without leaning on README summaries

## Notes

- `restore-core/` is currently useful and should be treated as a separate runnable scaffold, not random dead weight
- generated local state under `restore-core/.data/` should stay ignored and out of version control
- if you want a full slimming pass, audit removals against live imports first and prefer “prove unused, then delete”
