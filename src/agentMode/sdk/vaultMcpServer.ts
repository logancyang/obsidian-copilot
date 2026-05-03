/**
 * In-process MCP server exposing vault file operations to the Claude SDK.
 * Replaces the SDK's built-in `Read`/`Write`/`Edit` so the agent operates on
 * vault-relative paths and works on mobile / encrypted / non-filesystem
 * vaults. Writes go through `vault.modify` / `vault.create` so Obsidian's
 * `modify` / `create` events fire (Sync, Dataview, Templater, frontmatter,
 * link maintenance all depend on this).
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { TFile, type Vault } from "obsidian";
import { z } from "zod";

export const VAULT_MCP_SERVER_NAME = "obsidian-vault";

export function createVaultMcpServer(vault: Vault) {
  return createSdkMcpServer({
    name: VAULT_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      tool(
        "vault_read",
        "Read the full text contents of a note in the user's Obsidian vault. " +
          "Use vault-relative paths (e.g. `Daily/2026-05-01.md`).",
        { path: z.string().describe("Vault-relative path to the note") },
        async ({ path }) => {
          try {
            const text = await vault.adapter.read(path);
            return {
              content: [{ type: "text", text }],
            };
          } catch (err) {
            return toolError(
              `vault_read failed for ${path}: ${errorMessage(err)}. ` +
                `Verify the vault-relative path; try vault_list or vault_glob to discover valid paths.`
            );
          }
        }
      ),

      tool(
        "vault_write",
        "Create a new note or overwrite an existing one with the given content. " +
          "Use vault-relative paths.",
        {
          path: z.string().describe("Vault-relative path to the note"),
          content: z.string().describe("Full markdown content for the note"),
        },
        async ({ path, content }) => {
          try {
            const existing = vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
              await vault.modify(existing, content);
            } else if (existing) {
              return toolError(`vault_write failed: ${path} exists but is not a file.`);
            } else {
              await vault.create(path, content);
            }
            return {
              content: [{ type: "text", text: `Wrote ${content.length} chars to ${path}` }],
            };
          } catch (err) {
            return toolError(`vault_write failed for ${path}: ${errorMessage(err)}.`);
          }
        }
      ),

      tool(
        "vault_edit",
        "Edit a note by replacing exactly one occurrence of `old_string` with `new_string`. " +
          "Fails if `old_string` does not appear or appears more than once — read first to " +
          "disambiguate, or pass `replace_all: true` to replace every occurrence.",
        {
          path: z.string().describe("Vault-relative path to the note"),
          old_string: z.string().describe("Exact substring to replace"),
          new_string: z.string().describe("Replacement text"),
          replace_all: z
            .boolean()
            .optional()
            .describe("Replace all occurrences instead of failing on multiple matches"),
        },
        async ({ path, old_string, new_string, replace_all }) => {
          let original: string;
          try {
            original = await vault.adapter.read(path);
          } catch (err) {
            return toolError(`vault_edit failed to read ${path}: ${errorMessage(err)}.`);
          }
          const parts = original.split(old_string);
          const occurrences = parts.length - 1;
          if (occurrences === 0) {
            return toolError(
              `vault_edit failed: \`old_string\` not found in ${path}. Read the file first to find the exact text.`
            );
          }
          if (occurrences > 1 && !replace_all) {
            return toolError(
              `vault_edit failed: \`old_string\` appears ${occurrences} times in ${path}. ` +
                `Pass \`replace_all: true\` or include more context to make the match unique.`
            );
          }
          const updated = replace_all
            ? parts.join(new_string)
            : parts[0] + new_string + parts.slice(1).join(old_string);
          const tfile = vault.getAbstractFileByPath(path);
          if (!(tfile instanceof TFile)) {
            return toolError(`vault_edit failed: ${path} is not a file.`);
          }
          try {
            await vault.modify(tfile, updated);
          } catch (err) {
            return toolError(`vault_edit failed to write ${path}: ${errorMessage(err)}.`);
          }
          return {
            content: [
              {
                type: "text",
                text: `Edited ${path} (${occurrences} occurrence${occurrences === 1 ? "" : "s"} replaced)`,
              },
            ],
          };
        }
      ),

      tool(
        "vault_list",
        "List entries (files and folders) directly under a vault folder. Pass an empty " +
          "string to list the vault root.",
        { path: z.string().describe("Vault-relative folder path; empty string = root") },
        async ({ path }) => {
          try {
            const listed = await vault.adapter.list(path);
            const out = [
              ...listed.folders.map((f) => `[dir] ${f}`),
              ...listed.files.map((f) => `[file] ${f}`),
            ].join("\n");
            return {
              content: [{ type: "text", text: out || "(empty)" }],
            };
          } catch (err) {
            return toolError(
              `vault_list failed for ${path || "(root)"}: ${errorMessage(err)}. ` +
                `Verify the folder exists; pass an empty string to list the vault root.`
            );
          }
        }
      ),

      tool(
        "vault_glob",
        "List vault notes whose path matches a glob pattern. Supports `*`, `**`, and `?`. " +
          "Returns vault-relative paths (newline-separated).",
        { pattern: z.string().describe("Glob pattern (e.g. `Daily/**/*.md`)") },
        async ({ pattern }) => {
          const re = globToRegex(pattern);
          const all = vault.getMarkdownFiles();
          const matches = all.map((f) => f.path).filter((p) => re.test(p));
          return {
            content: [{ type: "text", text: matches.length ? matches.join("\n") : "(no matches)" }],
          };
        }
      ),

      tool(
        "vault_grep",
        "Search note contents for a regular expression. Returns matching `path:line: text` " +
          "lines. Use `path_filter` to restrict the scope to a folder or glob.",
        {
          pattern: z.string().describe("Regular expression (JavaScript flavor)"),
          path_filter: z
            .string()
            .optional()
            .describe("Optional glob (e.g. `Notes/**/*.md`) to limit search scope"),
        },
        async ({ pattern, path_filter }) => {
          let re: RegExp;
          try {
            re = new RegExp(pattern, "m");
          } catch (err) {
            return toolError(`vault_grep: invalid regex: ${String(err)}`);
          }
          const filterRe = path_filter ? globToRegex(path_filter) : null;
          const files = vault.getMarkdownFiles().filter((f) => !filterRe || filterRe.test(f.path));
          const out: string[] = [];
          const MAX_HITS = 200;
          for (const file of files) {
            if (out.length >= MAX_HITS) break;
            let text: string;
            try {
              // cachedRead reuses Obsidian's content cache — re-greps within
              // a session don't re-hit disk.
              text = await vault.cachedRead(file);
            } catch {
              continue;
            }
            const lines = text.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (re.test(lines[i])) {
                out.push(`${file.path}:${i + 1}: ${lines[i]}`);
                if (out.length >= MAX_HITS) break;
              }
            }
          }
          return {
            content: [
              {
                type: "text",
                text: out.length
                  ? `${out.join("\n")}${out.length === MAX_HITS ? "\n(truncated at 200 hits)" : ""}`
                  : "(no matches)",
              },
            ],
          };
        }
      ),
    ],
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toolError(message: string): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
} {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/**
 * Convert a glob pattern (`*`, `**`, `?`) to a JS RegExp anchored at both
 * ends. Mirrors minimatch semantics for the simple cases we need; brace
 * expansion and character classes are intentionally unsupported.
 */
export function globToRegex(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}
