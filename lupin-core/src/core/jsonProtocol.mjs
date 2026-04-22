/**
 * Attempts to extract a JSON object from a raw text string.
 *
 * Tries three strategies in order:
 * 1. Direct `JSON.parse` on the trimmed input.
 * 2. Extracts content from a fenced code block (``` or ```json) and parses it.
 * 3. Slices from the first `{` to the last `}` and parses the substring.
 *
 * @param {string} text - Raw text output from the model.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If none of the strategies produce a valid JSON object.
 */
export function extractJsonObject(text) {
  const raw = String(text || "").trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = raw.slice(first, last + 1);
    return JSON.parse(candidate);
  }

  throw new Error("unable to parse JSON object from model output");
}

/**
 * Normalizes alternative JSON shapes that various models (e.g. qwen) may emit
 * into the standard `{type: "tool_call", tool, args}` shape expected by the
 * agentic loop.
 *
 * Handles the following shorthand types:
 * - `file_write`  → `FileWriteTool`
 * - `file_read`   → `FileReadTool`
 * - `file_edit`   → `FileEditTool` (text-match mode)
 * - `file_patch`  → `FileEditTool` (line-range mode)
 * - `file_delete` → `FileDeleteTool`
 * - `bash`        → `BashTool`
 * - `web_search`  → `WebSearchTool`
 * - `web_fetch`   → `WebFetchTool`
 *
 * If the value does not match any known shorthand, it is returned unchanged.
 *
 * @param {object} value - A parsed JSON object from the model.
 * @returns {object} The normalized object, or the original value if no mapping applies.
 */
export function normalizeShape(value) {
  if (!value || typeof value !== "object") return value;

  // {"type":"file_write","path":"...","content":"..."} → FileWriteTool
  if (value.type === "file_write" && typeof value.path === "string") {
    return {
      type: "tool_call",
      tool: "FileWriteTool",
      args: { path: value.path, content: value.content ?? "" },
    };
  }

  // {"type":"file_read","path":"..."} → FileReadTool
  if (value.type === "file_read" && typeof value.path === "string") {
    return {
      type: "tool_call",
      tool: "FileReadTool",
      args: { path: value.path },
    };
  }

  // {"type":"file_edit","path":"...","oldText":"...","newText":"..."} → FileEditTool (text-match mode)
  if (value.type === "file_edit" && typeof value.path === "string") {
    return {
      type: "tool_call",
      tool: "FileEditTool",
      args: {
        path: value.path,
        oldText: value.oldText ?? "",
        newText: value.newText ?? "",
        replaceAll: value.replaceAll,
      },
    };
  }

  // {"type":"file_patch","path":"...","lineStart":N,"lineEnd":M,"newText":"..."} → FileEditTool (line-range mode)
  if (value.type === "file_patch" && typeof value.path === "string") {
    return {
      type: "tool_call",
      tool: "FileEditTool",
      args: {
        path: value.path,
        lineStart: value.lineStart,
        lineEnd: value.lineEnd,
        newText: value.newText ?? "",
      },
    };
  }

  // {"type":"file_delete","path":"..."} → FileDeleteTool
  if (value.type === "file_delete" && typeof value.path === "string") {
    return {
      type: "tool_call",
      tool: "FileDeleteTool",
      args: { path: value.path },
    };
  }

  // {"type":"bash","command":"..."} → BashTool
  if (value.type === "bash" && typeof value.command === "string") {
    return {
      type: "tool_call",
      tool: "BashTool",
      args: { command: value.command },
    };
  }

  // {"type":"web_search","query":"..."} → WebSearchTool
  if (value.type === "web_search" && typeof value.query === "string") {
    return {
      type: "tool_call",
      tool: "WebSearchTool",
      args: { query: value.query },
    };
  }

  // {"type":"web_fetch","url":"..."} → WebFetchTool
  if (value.type === "web_fetch" && typeof value.url === "string") {
    return {
      type: "tool_call",
      tool: "WebFetchTool",
      args: { url: value.url },
    };
  }

  return value;
}

/**
 * Returns `true` if the given value is a well-formed tool call object.
 *
 * A valid tool call must satisfy:
 * - `type === "tool_call"`
 * - `tool` is a non-empty string (the tool name)
 * - `args` is an object (the tool arguments)
 *
 * @param {unknown} value - The value to validate.
 * @returns {boolean} Whether `value` is a valid tool call shape.
 */
export function isValidToolCallShape(value) {
  return (
    value &&
    value.type === "tool_call" &&
    typeof value.tool === "string" &&
    typeof value.args === "object"
  );
}

/**
 * Returns `true` if the given value is a well-formed final response object.
 *
 * A valid final response must satisfy:
 * - `type === "final"`
 * - `content` is a string (the answer to be returned to the user)
 *
 * @param {unknown} value - The value to validate.
 * @returns {boolean} Whether `value` is a valid final response shape.
 */
export function isValidFinalShape(value) {
  return value && value.type === "final" && typeof value.content === "string";
}
