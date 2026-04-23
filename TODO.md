# TODO

## Priority 1

- **Improve editing reliability for large or ambiguous changes.**
  Done: unified-diff mode added to `FileEditTool` — accepts standard `@@ hunk @@` patches,
  applies hunks in reverse order, and uses fuzzy context-line matching to tolerate stale
  line numbers from the model. All three modes now: LINE-RANGE, TEXT-MATCH, UNIFIED-DIFF.
  Remaining: smarter conflict messaging when `oldText` drifts after earlier edits in the
  same session (currently throws; could suggest a re-read).

- **Make chat mode more consistent across weak models.**
  The mode separation, history scoping, and greeting handling are solid. Remaining gap:
  model-side reply style varies a lot on smaller Ollama models — terse, one-liner, or
  off-format responses still slip through without useful pushback.

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
  `/init` and `/refresh` are manual. Lupin should be able to notice when it has learned
  something new about the repo (new entrypoint, confirmed test command, architectural note)
  and offer to fold it into `LUPIN.md` without the user having to ask.

- **Better summaries for large repos.**
  The current preload strategy caps at 20 files / 80 KB and falls back to per-tool
  inspection. For large repos, Lupin should build a concise structural summary from
  inspected evidence (hotspots, key dirs, entrypoints) rather than leaving the model
  to piece it together across many steps.

- **Expose session introspection to the user.**
  `recentToolCalls` is tracked in `QueryEngine` but never surfaced. A `/debug` or
  expanded `/status` command showing the last N tool calls, their outcomes, and any
  workflow guard triggers would make behavior easier to diagnose.

## Priority 3

- **Add tests.**
  Zero test files exist. Highest-value targets: workspace detection (`workspaceInit.mjs`),
  system prompt construction, `FileEditTool` edge cases (non-unique match, out-of-range
  line numbers), and weak-answer fallback logic in `QueryEngine`.

- **Terminal UX polish.**
  Spinner and stats line are in. Small remaining gaps: clearer error formatting when a
  tool fails mid-task, better multi-step progress indication, and friendlier output when
  Ollama is unreachable at startup.