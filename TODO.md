# TODO

## Priority 1

- Slim Lupin into a clearer core product shape.
  Done: rebranded key user-facing entrypoints to Lupin, rewrote the root README/guide around the actual product, and removed obvious legacy leak-case-study assets.
  Next: split top-level areas into `core`, `optional/gated`, and `legacy/removable`, then disable or extract non-essential subsystems like KAIROS/assistant, buddy, voice, and bridge/remote from the default path before deleting anything.

- Strengthen editing reliability for implementation tasks.
  Done: added implementation workflow guardrails, a partial-edit tool for existing files, and anchored insert-before/after edits.
  Next: support unified-diff style edits and better conflict handling when the target text is no longer unique.

- Make `Lupin` more repo-aware on first contact.
  Detect likely entrypoints, build/test commands, framework signals, and architectural hotspots without relying too much on `README.md`.

- Add real CLI flags instead of only interactive slash commands.
  Implement `--help`, `--init`, `--context`, and a non-interactive task mode so the tool works well in scripts and shell workflows.

- Improve answer quality for project-level questions.
  Force better initial inspection strategies, avoid vague fallback replies, and summarize inspected evidence before conclusions.

- Add verification workflows.
  Done: implementation tasks now require some verification before finalizing if files were edited.
  Next: teach Lupin to infer the safest repo-native validation command automatically instead of relying on generic Bash guesses.

- Make chat mode more natural and less noisy.
  Done: separated chat history from command/code history, suppressed ambient `mg` lines for conversational replies, and added cleaner greeting handling.
  Next: improve model-side style consistency and reduce terse low-value replies from weaker Ollama models.

## Priority 2

- Strengthen tool selection logic.
  Prefer `GlobTool`, `GrepTool`, and targeted file reads before shell commands, and reduce noisy or redundant tool loops.

- Improve workspace onboarding.
  Make `/init` produce a stronger `LUPIN.md` with architecture notes, important files, commands, conventions, and preserved owner preferences.

- Add project memory refinement.
  Let Lupin update or propose edits to `LUPIN.md` as it learns the repository instead of treating it as a one-shot generated file.

- Add better repository summaries.
  Build concise summaries for large repos from inspected files rather than raw README excerpts.

## Priority 3

- Audit optional subsystems before hard deletion.
  Map what `dream`, assistant/KAIROS, buddy, voice, bridge, remote, and restore-core actually do in runtime, then decide what belongs in a minimal Lupin profile versus a power-user build.

- Add session introspection and debugging.
  Expose recent tool calls, failures, and reasoning breadcrumbs in a compact way so behavior is easier to diagnose.

- Improve terminal UX without turning it into fake GUI.
  Keep the shell clean, but add small quality improvements like clearer status lines, better errors, and maybe compact progress feedback.

- Add tests around onboarding and prompting.
  Cover workspace detection, prompt building, per-workspace memory, and weak-answer fallback behavior.

- Revisit branding only after behavior is solid.
  Keep the current identity, but defer deeper visual work until the tool feels consistently sharp in real use.
