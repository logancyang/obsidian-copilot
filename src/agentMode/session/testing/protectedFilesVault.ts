import type { ProtectedFiles } from "@/agentMode/session/protectedFiles";
import { requireNodeModule } from "@/utils/desktopRuntime";

const fs = requireNodeModule<typeof import("node:fs")>("fs");
const os = requireNodeModule<typeof import("node:os")>("os");
const path = requireNodeModule<typeof import("node:path")>("path");

export interface ProtectedFileCase {
  spelling: string;
  target: string;
  protected: boolean;
}

export interface ProtectedFilesVault {
  vault: string;
  rule: ProtectedFiles;
  cases: ProtectedFileCase[];
  remove: () => void;
}

export function createProtectedFilesVault(reason: string): ProtectedFilesVault {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "protected-files-")));
  const vault = path.join(root, "vault");
  const agents = path.join(vault, "copilot", "agents");
  const instructions = path.join(agents, "coco", "instructions.md");
  fs.mkdirSync(path.join(agents, "coco"), { recursive: true });
  fs.mkdirSync(path.join(vault, "notes"), { recursive: true });
  fs.writeFileSync(instructions, "You are Coco.");
  fs.symlinkSync(agents, path.join(vault, "shortcut"), "dir");
  fs.symlinkSync(agents, path.join(root, "outside"), "dir");
  fs.symlinkSync(instructions, path.join(vault, "notes", "coco.md"), "file");
  const longS = path.join(agents, "coco", "in\u017Ftructions.md");

  const cases: ProtectedFileCase[] = [
    { spelling: "an existing agent's file", target: instructions, protected: true },
    {
      spelling: "a new agent folder's file",
      target: path.join(agents, "new-agent", "instructions.md"),
      protected: true,
    },
    {
      spelling: "a path relative to the chat's folder",
      target: "copilot/agents/coco/instructions.md",
      protected: true,
    },
    {
      spelling: "'..'",
      target: path.join(vault, "notes", "..", "copilot", "agents", "coco", "instructions.md"),
      protected: true,
    },
    {
      spelling: "doubled and trailing separators",
      target: `${vault}${path.sep}copilot${path.sep}${path.sep}agents${path.sep}coco${path.sep}instructions.md${path.sep}`,
      protected: true,
    },
    {
      spelling: "another letter case",
      target: path.join(vault, "copilot", "Agents", "COCO", "Instructions.MD"),
      protected: true,
    },
    {
      spelling: "a symlinked folder inside the vault",
      target: path.join(vault, "shortcut", "new-agent", "instructions.md"),
      protected: true,
    },
    {
      spelling: "a symlinked folder outside the vault",
      target: path.join(root, "outside", "coco", "instructions.md"),
      protected: true,
    },
    {
      spelling: "a symlink to the file itself",
      target: path.join(vault, "notes", "coco.md"),
      protected: true,
    },
    {
      spelling: "a Unicode spelling the file system reads as the existing file",
      target: longS,
      protected: fs.existsSync(longS),
    },
    {
      spelling: "the agent's MEMORY.md",
      target: path.join(agents, "coco", "MEMORY.md"),
      protected: false,
    },
    {
      spelling: "another file of the agent",
      target: path.join(agents, "coco", "notes.md"),
      protected: false,
    },
    {
      spelling: "a longer name",
      target: path.join(agents, "coco", "instructions.md.bak"),
      protected: false,
    },
    {
      spelling: "the name outside the folder",
      target: path.join(vault, "notes", "instructions.md"),
      protected: false,
    },
    {
      spelling: "the name directly in the folder",
      target: path.join(agents, "instructions.md"),
      protected: false,
    },
    {
      spelling: "the name deeper in an agent's own folder",
      target: path.join(agents, "coco", "recipes", "instructions.md"),
      protected: false,
    },
    {
      spelling: "a look-alike folder",
      target: path.join(vault, "copilot", "agents-old", "coco", "instructions.md"),
      protected: false,
    },
  ];

  return {
    vault,
    rule: { folder: agents, fileName: "instructions.md", reason },
    cases,
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
