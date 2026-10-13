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

const CRLF_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/crlf-gone.md b/crlf-gone.md",
    "deleted file mode 100644",
    "index 2467add7a44c04dfed438103da76d7fffeb9c1a4..0000000000000000000000000000000000000000",
    "--- a/crlf-gone.md",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-Old list\r",
    "-remove me\r",
    "diff --git a/crlf-new.md b/crlf-new.md",
    "new file mode 100644",
    "index 0000000000000000000000000000000000000000..fbbee861521bd5355538b096fa3998541cd33909",
    "--- /dev/null",
    "+++ b/crlf-new.md",
    "@@ -0,0 +1,2 @@",
    "+alpha",
    "+beta",
    "diff --git a/crlf.md b/crlf.md",
    "index 924346369968f5c67c7c20bb88342262f3c26d31..222906096397faeefca791618698b6ff13a8e076",
    "--- a/crlf.md",
    "+++ b/crlf.md",
    "@@ -1,5 +1,6 @@",
    " # Shopping\r",
    " \r",
    " - milk\r",
    "-- eggs\r",
    "-- bread\r",
    "+- a dozen eggs",
    "+- bread",
    "+- butter",
    "",
  ].join("\n"),
};

const UNICODE_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/Notes/café plan.md b/Notes/café plan.md",
    "index 9f5be7ff8903191ca973ce613307699bcbd1fd30..8e0c095a6e2b10c0052da1ba4560a8a385a1dd72",
    "--- a/Notes/café plan.md",
    "+++ b/Notes/café plan.md",
    "@@ -1,4 +1,4 @@",
    " # Café plan",
    " ",
    "-Open on Monday.",
    "+Open on Tuesday.",
    " Serve crêpes.",
    "diff --git a/Notes/naïve idea 2.md b/Notes/naïve idea 2.md",
    "new file mode 100644",
    "index 0000000000000000000000000000000000000000..05f0201bd90188d92fb8d8aaf3b74acfa2fe7922",
    "--- /dev/null",
    "+++ b/Notes/naïve idea 2.md",
    "@@ -0,0 +1 @@",
    "+Try a 日本語 menu.",
    "",
  ].join("\n"),
};

const TRAILING_NEWLINE_REMOVED_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/tail.md b/tail.md",
    "index ac04283b6b69b9265da7e5bedbccadda09493aec..65ba5b1408f13c963426f66358adad0042bbdfb9",
    "--- a/tail.md",
    "+++ b/tail.md",
    "@@ -1,3 +1,3 @@",
    " first",
    " second",
    "-last line",
    "+LAST LINE",
    "\\ No newline at end of file",
    "",
  ].join("\n"),
};

const PATCH_THEN_SHELL_TURN_DIFF = {
  root: "/vault",
  unifiedDiff: [
    "diff --git a/mix.md b/mix.md",
    "index 1e395f2a2cc7a4eb70a20ce75a277933f71a968b..4d8fac743011ad10cef2e996554e6d337f699c2e",
    "--- a/mix.md",
    "+++ b/mix.md",
    "@@ -1,5 +1,5 @@",
    " alpha",
    "-beta",
    "+BETA",
    " gamma",
    " delta",
    " epsilon",
    "",
  ].join("\n"),
};

function patchFor(path: string, turnDiff = CODEX_TURN_DIFF, vaultBase = "/repo/vault") {
  const patch = filePatchesByVaultPath(turnDiff, vaultBase).get(path);
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

    it("keys paths relative to the vault itself when the diff root is the vault, as it is for a vault that is not a git repository", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "/repo/vault/",
          unifiedDiff: CODEX_TURN_DIFF.unifiedDiff.replace(/([ab])\/vault\//g, "$1/"),
        },
        "/repo/vault"
      );

      expect(patches.has("notes/plan.md")).toBe(true);
    });

    it("keys file names with spaces and non-ASCII characters exactly as Codex writes them", () => {
      expect([...filePatchesByVaultPath(UNICODE_TURN_DIFF, "/vault").keys()]).toEqual([
        "Notes/café plan.md",
        "Notes/naïve idea 2.md",
      ]);
    });

    it("keys paths relative to the vault when the diff root is a Windows path", () => {
      const patches = filePatchesByVaultPath(
        {
          root: "C:\\Users\\me\\repo\\",
          unifiedDiff: CODEX_TURN_DIFF.unifiedDiff,
        },
        "C:\\Users\\me\\repo\\vault"
      );

      expect([...patches.keys()].sort()).toEqual([
        "notes/obsolete.md",
        "notes/plan.md",
        "notes/retro.md",
      ]);
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

    it("recovers CRLF originals byte for byte, including lines apply_patch rewrote with LF endings", () => {
      expect(
        revertFilePatch(
          patchFor("crlf.md", CRLF_TURN_DIFF, "/vault"),
          "# Shopping\r\n\r\n- milk\r\n- a dozen eggs\n- bread\n- butter\n"
        )
      ).toBe("# Shopping\r\n\r\n- milk\r\n- eggs\r\n- bread\r\n");
      expect(revertFilePatch(patchFor("crlf-gone.md", CRLF_TURN_DIFF, "/vault"), null)).toBe(
        "Old list\r\nremove me\r\n"
      );
      expect(
        revertFilePatch(patchFor("crlf-new.md", CRLF_TURN_DIFF, "/vault"), "alpha\nbeta\n")
      ).toBeNull();
    });

    it("recovers a file whose edit removed its final newline", () => {
      expect(
        revertFilePatch(
          patchFor("tail.md", TRAILING_NEWLINE_REMOVED_TURN_DIFF, "/vault"),
          "first\nsecond\nLAST LINE"
        )
      ).toBe("first\nsecond\nlast line\n");
    });

    it("keeps a later shell change outside the patched lines in the recovered text, so the entry shows only apply_patch's change https://github.com/Brevilabs/obsidian-copilot-private/issues/689", () => {
      expect(
        revertFilePatch(
          patchFor("mix.md", PATCH_THEN_SHELL_TURN_DIFF, "/vault"),
          "alpha\nBETA\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\n"
        )
      ).toBe("alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\nTHETA\n");
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

    it("reports a file that did not exist before the turn as created (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      const change = buildTurnFileChange("notes/new.md", null, "fresh\nnote\n");
      expect(change).toMatchObject({
        status: "created",
        before: null,
        additions: 2,
        deletions: 0,
      });
    });

    it("reports a file the turn removed as deleted (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
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

    it("returns null for a file that never existed on either side (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      expect(buildTurnFileChange("notes/ghost.md", null, null)).toBeNull();
    });

    it("counts an emptied file's every line as removed (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      expect(buildTurnFileChange("notes/a.md", "one\ntwo\n", "")).toMatchObject({
        status: "modified",
        additions: 0,
        deletions: 2,
      });
    });
  });
});
