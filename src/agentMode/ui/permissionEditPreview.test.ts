import { App, FileSystemAdapter, TFile } from "obsidian";
import { synthesizePermissionEditDiff } from "@/agentMode/ui/permissionEditPreview";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import type { ToolCallContent } from "@/agentMode/session/types";

// A minimal fake `app`: only the vault methods the synthesizer touches. Paths
// are already vault-relative in these cases (no `adapter`), so `getVaultBase`
// returns null and `toVaultRelative` passes the path through. Pass `basePath`
// to attach a `FileSystemAdapter` and exercise absolute→relative normalization.
function fakeApp(vault: Partial<App["vault"]> = {}, basePath?: string): App {
  return {
    vault: {
      getAbstractFileByPath: () => null,
      read: async () => "",
      ...(basePath !== undefined
        ? { adapter: new (FileSystemAdapter as unknown as new (b: string) => unknown)(basePath) }
        : {}),
      ...vault,
    },
  } as unknown as App;
}

beforeEach(() => {
  __resetVaultBaseCache();
});

describe("synthesizePermissionEditDiff", () => {
  it("uses old_string/new_string for an Edit without reading the vault", async () => {
    const read = jest.fn();
    const app = fakeApp({ read });
    const diff = await synthesizePermissionEditDiff(app, {
      rawInput: { file_path: "notes/a.md", old_string: "before", new_string: "after" },
    });
    expect(diff).toEqual({ path: "notes/a.md", oldText: "before", newText: "after" });
    expect(read).not.toHaveBeenCalled();
  });

  it("reads the existing file as the before for a Write", async () => {
    // The obsidian mock's `TFile` constructor takes a path and yields a real
    // instance, so the production `file instanceof TFile` check passes. The
    // public obsidian type declares no constructor args, hence the cast.
    const file = new (TFile as unknown as new (path: string) => TFile)("notes/b.md");
    const app = fakeApp({
      getAbstractFileByPath: jest.fn(() => file),
      read: jest.fn(async () => "current contents"),
    });
    const diff = await synthesizePermissionEditDiff(app, {
      rawInput: { file_path: "notes/b.md", content: "brand new body" },
    });
    expect(diff).toEqual({
      path: "notes/b.md",
      oldText: "current contents",
      newText: "brand new body",
    });
    expect(app.vault.read).toHaveBeenCalledWith(file);
  });

  it("treats a missing file as a create (empty before) for a Write", async () => {
    const app = fakeApp({ getAbstractFileByPath: jest.fn(() => null) });
    const diff = await synthesizePermissionEditDiff(app, {
      rawInput: { file_path: "notes/new.md", content: "fresh" },
    });
    expect(diff).toEqual({ path: "notes/new.md", oldText: "", newText: "fresh" });
  });

  it("returns an ACP content diff directly when present", async () => {
    const content: ToolCallContent[] = [
      { type: "diff", path: "notes/c.md", oldText: "was", newText: "now" },
    ];
    const app = fakeApp();
    const diff = await synthesizePermissionEditDiff(app, {
      rawInput: { file_path: "ignored.md", content: "ignored" },
      content,
    });
    expect(diff).toEqual({ path: "notes/c.md", oldText: "was", newText: "now" });
  });

  it("normalizes an absolute ACP diff path to vault-relative", async () => {
    // ACP diff paths arrive raw (often absolute); the chip label and the
    // diff-pane leaf reuse both key off `path`, so it must match the
    // vault-relative form the post-execution ActionCard uses.
    const content: ToolCallContent[] = [
      { type: "diff", path: "/vault/notes/c.md", oldText: "was", newText: "now" },
    ];
    const diff = await synthesizePermissionEditDiff(fakeApp({}, "/vault"), {
      rawInput: { file_path: "/vault/notes/c.md", content: "ignored" },
      content,
    });
    expect(diff).toEqual({ path: "notes/c.md", oldText: "was", newText: "now" });
  });

  it("normalizes a null ACP diff oldText to an empty string", async () => {
    const content: ToolCallContent[] = [
      { type: "diff", path: "notes/d.md", oldText: null, newText: "created" },
    ];
    const diff = await synthesizePermissionEditDiff(fakeApp(), { content });
    expect(diff).toEqual({ path: "notes/d.md", oldText: "", newText: "created" });
  });

  it("returns null for a non-edit tool (e.g. a Bash command)", async () => {
    const diff = await synthesizePermissionEditDiff(fakeApp(), {
      rawInput: { command: "ls -la" },
    });
    expect(diff).toBeNull();
  });

  it("returns null when an edit-shaped path is missing", async () => {
    const diff = await synthesizePermissionEditDiff(fakeApp(), {
      rawInput: { old_string: "a", new_string: "b" },
    });
    expect(diff).toBeNull();
  });
});
