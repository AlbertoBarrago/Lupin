/**
 * @module permissions
 * @description Security policy enforcement for the tool runtime.
 * Classifies tool risk levels and blocks dangerous bash commands
 * before they reach the shell.
 */

/**
 * Regular-expression patterns that identify shell commands considered
 * too destructive to run without explicit operator approval.
 * Any `BashTool` invocation whose `command` string matches one of these
 * patterns will be denied when `denyDangerousBash` is enabled.
 *
 * @type {RegExp[]}
 */
const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  />\s*\/dev\/sd[a-z]/i,
];

/**
 * Returns a broad risk classification for a given tool name.
 *
 * | Risk level | Tools                                          |
 * |------------|------------------------------------------------|
 * | `LOW`      | `FileReadTool`, `GlobTool`, `GrepTool`         |
 * | `MEDIUM`   | `FileWriteTool`, `FileEditTool`, unknown tools |
 * | `HIGH`     | `BashTool`                                     |
 *
 * @param {string} toolName - The registered name of the tool being invoked.
 * @returns {'LOW' | 'MEDIUM' | 'HIGH'} The risk level assigned to the tool.
 */
export function classifyRisk(toolName) {
  if (
    toolName === "FileReadTool" ||
    toolName === "FileBatchReadTool" ||
    toolName === "GlobTool" ||
    toolName === "GrepTool" ||
    toolName === "WebSearchTool" ||
    toolName === "WebFetchTool"
  ) {
    return "LOW";
  }
  if (
    toolName === "FileWriteTool" ||
    toolName === "FileEditTool" ||
    toolName === "FileDeleteTool"
  ) {
    return "MEDIUM";
  }
  if (toolName === "BashTool") {
    return "HIGH";
  }
  return "MEDIUM";
}

/**
 * Evaluates whether a tool invocation is permitted under the active
 * security configuration.
 *
 * Currently the only enforced rule is: when `securityConfig.denyDangerousBash`
 * is `true`, any `BashTool` call whose `command` argument matches a pattern in
 * {@link DANGEROUS_BASH_PATTERNS} is rejected.
 *
 * @param {string} toolName - The registered name of the tool being invoked.
 * @param {Record<string, unknown>} args - The raw arguments passed to the tool.
 * @param {{ denyDangerousBash: boolean }} securityConfig - Security settings
 *   derived from the agent configuration (see `loadConfig`).
 * @returns {{ allowed: boolean, risk: 'LOW' | 'MEDIUM' | 'HIGH', reason?: string }}
 *   An object indicating whether execution is permitted, the assessed risk
 *   level, and an optional human-readable `reason` when `allowed` is `false`.
 */
/**
 * Converts a simple shell glob pattern (e.g. `*.js`, `*.{ts,mjs}`) into a
 * JavaScript regex string suitable for `GlobTool` or `GrepTool`.
 *
 * @param {string} glob - Shell glob pattern.
 * @returns {string} Equivalent regex string.
 */
function globToRegex(glob) {
  return glob
    .replace(/\./g, "\\.")
    .replace(/\{([^}]+)\}/g, (_, g) => `(${g.split(",").join("|")})`)
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
}

/**
 * Attempts to map a BashTool command string to a safer, more efficient native
 * tool call. Handles the most common patterns where the model reaches for shell
 * utilities instead of dedicated tools:
 *
 * | Shell command                   | Redirected to  |
 * |---------------------------------|----------------|
 * | `cat <file>`                    | FileReadTool   |
 * | `ls [dir]`                      | GlobTool       |
 * | `find <dir> -name <pattern>`    | GlobTool       |
 * | `grep [-flags] <pattern> [dir]` | GrepTool       |
 *
 * @param {string} command - Raw shell command string from BashTool args.
 * @returns {{ tool: string, args: object, note: string } | null}
 *   A redirect descriptor, or `null` if no redirect applies.
 */
export function redirectBashToTool(command) {
  const cmd = String(command || "").trim();

  // cat <single-file>  (no pipes, no redirects, no multiple args)
  // Handles: cat file.js  cat ./path  cat 'file with spaces.txt'  cat "quoted.js"
  const catMatch =
    cmd.match(/^cat\s+'([^']+)'$/) ||
    cmd.match(/^cat\s+"([^"]+)"$/) ||
    cmd.match(/^cat\s+([^\s|&;><'"]+)$/);
  if (catMatch) {
    return {
      tool: "FileReadTool",
      args: { path: catMatch[1] },
      note: "redirected: cat → FileReadTool (prefer FileReadTool directly)",
    };
  }

  // ls [-flags] [dir]
  const lsMatch = cmd.match(
    /^ls(?:\s+-[a-zA-Z]+)?\s*(['"]?)([^\s|&;><'"]*)\1$/,
  );
  if (lsMatch) {
    const dir = (lsMatch[2] || "").replace(/\/$/, "");
    const pattern = dir ? `^${dir}/[^/]+` : "^[^/]+";
    return {
      tool: "GlobTool",
      args: { pattern },
      note: "redirected: ls → GlobTool (prefer GlobTool directly)",
    };
  }

  // find <dir> -name "pattern"  (simple single -name predicate)
  const findMatch = cmd.match(
    /^find\s+([^\s]+)\s+.*?-name\s+["']?([^"'\s;|&>]+)["']?/,
  );
  if (findMatch) {
    return {
      tool: "GlobTool",
      args: { pattern: globToRegex(findMatch[2]) },
      note: "redirected: find -name → GlobTool (prefer GlobTool directly)",
    };
  }

  // grep [-flags] "pattern" [path]  (no pipes)
  // Covers: grep -r "foo" src/, grep -rn pattern ., grep "pattern" file.js
  const grepMatch = cmd.match(
    /^grep\s+((?:-\w+\s+)*)["']?([^"'\s|&;><]+)["']?\s*([^\s|&;><]*)$/,
  );
  if (grepMatch) {
    const pattern = grepMatch[2];
    const rawPath = (grepMatch[3] || "").trim();
    const args = { pattern };
    if (rawPath && rawPath !== ".") args.path = rawPath;
    return {
      tool: "GrepTool",
      args,
      note: "redirected: grep → GrepTool (prefer GrepTool directly)",
    };
  }

  return null;
}

export function enforcePolicy(toolName, args, securityConfig) {
  const risk = classifyRisk(toolName);
  if (toolName === "BashTool" && securityConfig.denyDangerousBash) {
    const command = String(args?.command || "");
    const blocked = DANGEROUS_BASH_PATTERNS.find((pattern) =>
      pattern.test(command),
    );
    if (blocked) {
      return {
        allowed: false,
        risk,
        reason: "command blocked by security policy",
      };
    }
  }

  return { allowed: true, risk };
}
