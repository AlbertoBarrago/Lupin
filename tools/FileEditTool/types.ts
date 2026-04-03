import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'

// The input schema with optional replace_all
const inputSchema = lazySchema(() =>
  z
    .strictObject({
      file_path: z.string().describe('The absolute path to the file to modify'),
      old_string: z.string().optional().describe('The text to replace'),
      new_string: z.string().describe('The text to insert or replace with'),
      insert_before: z
        .string()
        .optional()
        .describe('Insert new_string immediately before this text'),
      insert_after: z
        .string()
        .optional()
        .describe('Insert new_string immediately after this text'),
      replace_all: semanticBoolean(
        z.boolean().default(false).optional(),
      ).describe('Replace all occurrences of old_string (default false)'),
    })
    .superRefine((value, ctx) => {
      const hasOldString = value.old_string !== undefined
      const hasInsertBefore = value.insert_before !== undefined
      const hasInsertAfter = value.insert_after !== undefined

      if (hasInsertBefore && hasInsertAfter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['insert_after'],
          message: 'Use only one of insert_before or insert_after.',
        })
      }

      if (hasOldString && (hasInsertBefore || hasInsertAfter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['old_string'],
          message:
            'old_string cannot be combined with insert_before or insert_after.',
        })
      }

      if (!hasOldString && !hasInsertBefore && !hasInsertAfter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['old_string'],
          message:
            'Provide old_string for replacements, or insert_before/insert_after for anchored insertions.',
        })
      }

      if (
        (hasInsertBefore || hasInsertAfter) &&
        value.replace_all !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['replace_all'],
          message: 'replace_all is only valid with old_string replacements.',
        })
      }
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

// Parsed output — what call() receives. z.output not z.input: with
// semanticBoolean the input side is unknown (preprocess accepts anything).
export type FileEditInput = z.output<InputSchema>

// Individual edit without file_path
export type EditInput = Omit<FileEditInput, 'file_path'>

// Runtime version where replace_all is always defined
export type FileEdit =
  | {
      old_string: string
      new_string: string
      replace_all: boolean
      insert_before?: undefined
      insert_after?: undefined
    }
  | {
      old_string?: undefined
      new_string: string
      replace_all?: false | undefined
      insert_before: string
      insert_after?: undefined
    }
  | {
      old_string?: undefined
      new_string: string
      replace_all?: false | undefined
      insert_before?: undefined
      insert_after: string
    }

export const hunkSchema = lazySchema(() =>
  z.object({
    oldStart: z.number(),
    oldLines: z.number(),
    newStart: z.number(),
    newLines: z.number(),
    lines: z.array(z.string()),
  }),
)

export const gitDiffSchema = lazySchema(() =>
  z.object({
    filename: z.string(),
    status: z.enum(['modified', 'added']),
    additions: z.number(),
    deletions: z.number(),
    changes: z.number(),
    patch: z.string(),
    repository: z
      .string()
      .nullable()
      .optional()
      .describe('GitHub owner/repo when available'),
  }),
)

// Output schema for FileEditTool
const outputSchema = lazySchema(() =>
  z.object({
    filePath: z.string().describe('The file path that was edited'),
    oldString: z.string().describe('The original string that was replaced'),
    newString: z.string().describe('The new string that replaced it'),
    originalFile: z
      .string()
      .describe('The original file contents before editing'),
    structuredPatch: z
      .array(hunkSchema())
      .describe('Diff patch showing the changes'),
    userModified: z
      .boolean()
      .describe('Whether the user modified the proposed changes'),
    replaceAll: z.boolean().describe('Whether all occurrences were replaced'),
    gitDiff: gitDiffSchema().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type FileEditOutput = z.infer<OutputSchema>

export { inputSchema, outputSchema }
