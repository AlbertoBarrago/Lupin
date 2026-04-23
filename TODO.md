# TODO

## Priority 1

- **Improve editing reliability for large or ambiguous changes.**
  Done: unified-diff mode added to `FileEditTool` — accepts standard `@@ hunk @@` patches,
  applies hunks in reverse order, and uses fuzzy context-line matching to tolerate stale
  line numbers from the model. All three modes now: LINE-RANGE, TEXT-MATCH, UNIFIED-DIFF.
  Done: `QueryEngine` now detects when `FileEditTool` fails on a file already modified
  this session and emits a `FILE_DRIFT` message instead of the generic re-read hint.

- **Make chat mode more consistent across weak models.**
  The mode separation, history scoping, and greeting handling are solid.
  Done: `isWeakFinalAnswer` extended to catch common filler phrases ("ok", "sure",
  "of course", "I'll help you", etc.). `FORMAT_ERROR` pushback now echoes the first
  120 chars of the failing raw response so the model can see exactly what went wrong.

- **Strengthen tool selection behavior.**
  Done: `ToolRuntime.execute()` now transparently redirects common bash-as-read patterns
  (`cat`, `ls`, `find -name`, `grep`) to their native tools (`FileReadTool`, `GlobTool`,
  `GrepTool`) before the shell is touched. Falls back to real BashTool if the redirect
  fails. Risk classification extended to cover `FileBatchReadTool`, `FileDeleteTool`,
  `WebSearchTool`, `WebFetchTool`.
  Remaining: model still reaches for bash on less common patterns — monitor and extend
  the redirect table as new cases emerge.

## Priority 2

- **Add automatic LUPIN.md update proposals.**
  Done: after any task where files were inspected and `LUPIN.md` exists in the project
  root, `index.mjs` prints a dim hint `run /init to update LUPIN.md`. Fires once per
  session to avoid noise.

- **Better summaries for large repos.**
  Done: `QueryEngine.runTask` now injects a `REPO_SUMMARY` message when preload returns
  null but a snapshot exists. Gives the model stack, frameworks, entry files, hotspots,
  and key dirs as a compact starting map — saves exploratory steps on large repos.

- **Expose session introspection to the user.**
  Done: `runTask` now returns `toolLog` (full per-step tool call history with ok/fail)
  and `changedFiles`. New `/debug` command in `index.mjs` displays step count, per-tool
  results, inspected files, changed files, and token stats from the last task.

## Priority 3

- **Add tests.**
  Done: 32 tests across 4 files (`lupin-core/tests/`) using `node:test` (zero deps).
  Covers: `FileEditTool` all three modes + edge cases, `buildSystemPrompt`, `renderLupinMd`
  / `formatWorkspaceSnapshot`, and `isWeakFinalAnswer` (now exported). Run: `npm test`.

- **Terminal UX polish.**
  Done: tool fail mid-task → spinner stops, red `✗ toolname: error` line, spinner
  resumes as "retrying". Step counter in spinner label `(N)` tracks tool calls.
  Startup non-blocking Ollama healthcheck → yellow `⚠` with `ollama serve` hint
  if unreachable.