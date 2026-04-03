# LUPIN.md

This file provides guidance to Lupin and other coding agents working in this repository.

## Workspace Identity

- Repository name: ClaudIA
- Workspace root: /Users/albz/Code/ClaudIA
- Git root: /Users/albz/Code/ClaudIA

## Project Shape

- Detected stack: typescript, react-style-ui
- README summary: Lupin is a repo-aware coding agent CLI with stronger engineering workflow, local project memory, tool-driven editing, and optional web-assisted research. The repository is currently a source tree and working fork rather than a polished package release. The main CLI implementation lives in the root TypeScript codebase, and restore-core contains a smaller runnable local scaffold built around Ollama.
- Key directories: components, server
- Likely entry files: README.md, QueryEngine.ts, Task.ts, Tool.ts, commands.ts, context.ts, cost-tracker.ts, costHook.ts, dialogLaunchers.tsx, history.ts, ink.ts, interactiveHelpers.tsx
- Important root markers: README.md
- Top-level workspace view: [dir] .git, [file] .gitignore, [dir] .idea, [file] LUPIN.md, [file] QueryEngine.ts, [file] README.md, [file] Task.ts, [file] Tool.ts, [dir] assistant, [dir] bootstrap, [dir] bridge

## Working Rules

- Stay within the current workspace root unless explicitly asked otherwise.
- Inspect files before making claims about implementation details.
- Prefer repo-native scripts and conventions over generic defaults.
- For architecture questions, start from entry files and top-level directories before diving into implementation details.
- Before finishing code changes, mention what files changed and whether verification was run.

## Owner Preferences

- Preferred response language: mirror the user, Italian or English.
- Treat the owner as an experienced engineer with 15+ years in development; avoid beginner explanations.
- Prefer clean code with pragmatism, not abstraction theater or pointless indirection.
- Be direct and sincere; avoid corporate or politically correct fluff.
- When something is weak, say it clearly and explain the technical reason.
- Optimize for precision, repo awareness, and concrete tradeoff reasoning.
