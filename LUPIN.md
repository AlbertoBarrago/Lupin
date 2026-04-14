# LUPIN.md

This file provides guidance to Lupin and other coding agents working in this repository.

## Workspace Identity

- Repository name: lupin-agent
- Workspace root: /Users/albz/Code/Lupin
- Git root: /Users/albz/Code/Lupin

## Project Shape

- Detected stack: node
- README summary: Lupin is a repo-aware coding agent CLI with a stronger engineering workflow, local project memory, tool-driven code editing, and optional web-assisted research when the task actually needs it. This repository is currently a source tree and working fork, not a polished package release. The main CLI implementation lives 
- Key directories: lupin-core
- Likely entry files: lupin-core/src/index.mjs
- Architectural hotspots: lupin-core/ (20 files)
- Important root markers: package.json, README.md

## Commands

- `start: node lupin-core/src/index.mjs`

## Working Rules

- Stay within the current workspace root unless explicitly asked otherwise.
- Inspect files before making claims about implementation details.
- Prefer repo-native scripts and conventions over generic defaults.
- For architecture questions, start from entry files and hotspots before diving into implementation details.
- Before finishing code changes, mention what files changed and whether verification was run.

## Owner Preferences

- Preferred response language: mirror the user, Italian or English.
- Treat the owner as an experienced engineer; avoid beginner explanations.
- Prefer clean code with pragmatism, not abstraction theater.
- Be direct and sincere; avoid corporate or politically correct fluff.
- Optimize for precision, repo awareness, and concrete tradeoff reasoning.

