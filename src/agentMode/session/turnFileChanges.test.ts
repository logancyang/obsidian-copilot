import {
  buildTurnFileChange,
  filePatchesByVaultPath,
  revertFilePatch,
} from "@/agentMode/session/turnFileChanges";

const PLAN_BEFORE =
  "# Project Plan\n\n## Goals\n\n- Ship the beta\n- Collect feedback\n\n## Timeline\n\nWeek 1: design\nWeek 2: build\nWeek 3: test\n\n## Risks\n\nNone known yet.\n\n## Notes\n\nLast line without newline";
const PLAN_AFTER =
  "# Project Plan\n\n## Goals\n\n- Ship the beta on Friday\n- Collect feedback\n\n## Timeline\n\nWeek 1: design\nWeek 2: build\nWeek 3: test\nWeek 4: release\n\n## Risks\n\nVendor delay is possible.\n\n## Notes\n\nLast line without newline\n";

const CODEX_TURN_DIFF = {
  root: "/repo",
  unifiedDiff: [
    "diff --git a/vault/notes/obsolete.md b/vault/notes/obsolete.md",
    "deleted file mode 100644",
    "index aab8398..0000000",
    "--- a/vault/notes/obsolete.md",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-This note is obsolete.",
    "diff --git a/vault/notes/plan.md b/vault/notes/plan.md",
    "index b369ee9..aec1ef1",
    "--- a/vault/notes/plan.md",
    "+++ b/vault/notes/plan.md",
    "@@ -2,7 +2,7 @@",
    " ",
    " ## Goals",
    " ",
    "-- Ship the beta",
    "+- Ship the beta on Friday",
    " - Collect feedback",
    " ",
    " ## Timeline",
    "@@ -10,11 +10,12 @@",
    " Week 1: design",
    " Week 2: build",
    " Week 3: test",
    "+Week 4: release",
    " ",
    " ## Risks",
    " ",
    "-None known yet.",
    "+Vendor delay is possible.",
    " ",
    " ## Notes",
    " ",
    "-Last line without newline",
    "\\ No newline at end of file",
    "+Last line without newline",
    "diff --git a/vault/notes/retro.md b/vault/notes/retro.md",
    "new file mode 100644",
    "index 0000000..36a9e59",
    "--- /dev/null",
    "+++ b/vault/notes/retro.md",
    "@@ -0,0 +1,3 @@",
    "+# Retro",
    "+",
    "+Went well.",
    "",
  ].join("\n"),
};

function patchFor(path: string) {
  const patch = filePatchesByVaultPath(CODEX_TURN_DIFF, "/repo/vault").get(path);
  if (!patch) throw new Error(`no patch for ${path}`);
  return patch;
}

describe("turnFileChanges", () => {
  describe("filePatchesByVaultPath()", () => {
    it("keys each file's patch by its vault path when the diff root is a repository above the vault https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      const patches = filePatchesByVaultPath(CODEX_TURN_DIFF, "/repo/vault");

      expect([...patches.keys()].sort()).toEqual([
        "notes/obsolete.md",
        "notes/plan.md",
        "notes/retro.md",
      ]);
    });

    it("keys paths relative to the vault itself when the diff root is the vault", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "/repo/vault/",
          unifiedDiff: CODEX_TURN_DIFF.unifiedDiff.replace(/([ab])\/vault\//g, "$1/"),
        },
        "/repo/vault"
      );

      expect(patches.has("notes/plan.md")).toBe(true);
    });

    it("leaves a renamed file out so both of its paths fall back to their own snapshots https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "/repo",
          unifiedDiff: [
            "diff --git a/vault/old.md b/vault/new.md",
            "similarity index 80%",
            "rename from vault/old.md",
            "rename to vault/new.md",
            "--- a/vault/old.md",
            "+++ b/vault/new.md",
            "@@ -1 +1 @@",
            "-old",
            "+new",
            "",
          ].join("\n"),
        },
        "/repo/vault"
      );

      expect(patches.size).toBe(0);
    });
  });

  describe("revertFilePatch()", () => {
    it("recovers a multi-hunk edit's original bytes, including an insertion-only hunk and a missing final newline", () => {
      expect(revertFilePatch(patchFor("notes/plan.md"), PLAN_AFTER)).toBe(PLAN_BEFORE);
    });

    it("returns null for a file the patch created", () => {
      expect(revertFilePatch(patchFor("notes/retro.md"), "# Retro\n\nWent well.\n")).toBeNull();
    });

    it("recovers the content of a file the patch deleted", () => {
      expect(revertFilePatch(patchFor("notes/obsolete.md"), null)).toBe("This note is obsolete.\n");
    });

    it("returns undefined when the file changed after the patch so it no longer applies https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      expect(
        revertFilePatch(patchFor("notes/plan.md"), "# Project Plan\n\nRewritten by the user.\n")
      ).toBeUndefined();
    });

    it("returns undefined for an edited file that is now missing or a deleted file that is back https://github.com/Brevilabs/obsidian-copilot-private/issues/347", () => {
      expect(revertFilePatch(patchFor("notes/plan.md"), null)).toBeUndefined();
      expect(revertFilePatch(patchFor("notes/obsolete.md"), "recreated\n")).toBeUndefined();
    });
  });

  describe("buildTurnFileChange()", () => {
    it("counts the added and removed lines of an edited file", () => {
      expect(
        buildTurnFileChange("notes/a.md", "one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n")
      ).toEqual({
        path: "notes/a.md",
        status: "modified",
        before: "one\ntwo\nthree\n",
        after: "one\nTWO\nthree\nfour\n",
        additions: 2,
        deletions: 1,
      });
    });

    it("reports a file that did not exist before the turn as created", () => {
      const change = buildTurnFileChange("notes/new.md", null, "fresh\nnote\n");
      expect(change).toMatchObject({
        status: "created",
        before: null,
        additions: 2,
        deletions: 0,
      });
    });

    it("reports a file the turn removed as deleted", () => {
      const change = buildTurnFileChange("notes/gone.md", "one\ntwo\n", null);
      expect(change).toMatchObject({
        status: "deleted",
        after: null,
        additions: 0,
        deletions: 2,
      });
    });

    it("returns null when the turn left the file byte-identical", () => {
      expect(buildTurnFileChange("notes/a.md", "same\n", "same\n")).toBeNull();
    });

    it("returns null for a file that never existed on either side", () => {
      expect(buildTurnFileChange("notes/ghost.md", null, null)).toBeNull();
    });

    it("counts an emptied file's every line as removed", () => {
      expect(buildTurnFileChange("notes/a.md", "one\ntwo\n", "")).toMatchObject({
        status: "modified",
        additions: 0,
        deletions: 2,
      });
    });
  });
});
