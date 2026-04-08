# LUPIN.md

This file provides guidance to Lupin and other coding agents working in this repository.

## Workspace Identity

- Repository name: Lupin
- Workspace root: /Users/albz/Code/Lupin
- Git root: /Users/albz/Code/Lupin

## Project Shape

- Detected stack: typescript, react-style-ui
- README summary: Lupin is a repo-aware coding agent CLI with a stronger engineering workflow, local project memory, tool-driven code editing, and optional web-assisted research when the task actually needs it. This repository is currently a source tree and working fork, not a polished package release. The main CLI implementation lives 
- Key directories: assistant, bootstrap, bridge, buddy, cli, commands, components, constants, context, coordinator, entrypoints, hooks, ink, keybindings, memdir, migrations, moreright, native-ts, outputStyles, plugins, public, query, remote, restore-core, schemas, screens, server, services, skills, startup, state, tasks, tools, types, upstreamproxy, utils, vim, voice
- Likely entry files: main.tsx
- Architectural hotspots: utils/ (564 files), components/ (389 files), commands/ (207 files), tools/ (184 files), services/ (130 files), hooks/ (104 files)
- Important root markers: README.md

## Working Rules

- Stay within the current workspace root unless explicitly asked otherwise.
- Inspect files before making claims about implementation details.
- Prefer repo-native scripts and conventions over generic defaults.
- For architecture questions, start from entry files and hotspots before diving into implementation details.
- Before finishing code changes, mention what files changed and whether verification was run.

## Owner Preferences

- Preferred response language: mirror the user, Italian or English.
- Treat the owner as an experienced engineer with 15+ years in development; avoid beginner explanations.
- Prefer clean code with pragmatism, not abstraction theater or pointless indirection.
- Be direct and sincere; avoid corporate or politically correct fluff.
- When something is weak, say it clearly and explain the technical reason.
- Optimize for precision, repo awareness, and concrete tradeoff reasoning.

