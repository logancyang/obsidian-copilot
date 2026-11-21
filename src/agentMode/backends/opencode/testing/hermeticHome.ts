import { requireNodeModule } from "@/utils/desktopRuntime";

const fs = requireNodeModule<typeof import("node:fs")>("fs");
const os = requireNodeModule<typeof import("node:os")>("os");
const path = requireNodeModule<typeof import("node:path")>("path");

const HOME_ENV = [
  "HOME",
  "USERPROFILE",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
] as const;
const UNSET_ENV = ["OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT"] as const;
const ONE_PATH_WRITERS = ["writeFile", "appendFile", "mkdir", "rm", "unlink"] as const;
const TWO_PATH_WRITERS = ["rename", "copyFile"] as const;

export interface HermeticHome {
  root: () => string;
  home: () => string;
}

function inside(root: string, target: unknown): boolean {
  const resolved = path.resolve(String(target));
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function guard(owner: object, label: string, root: () => string, suffix = ""): jest.SpyInstance[] {
  const writers: Array<[string, number]> = [
    ...ONE_PATH_WRITERS.map((name): [string, number] => [`${name}${suffix}`, 1]),
    ...TWO_PATH_WRITERS.map((name): [string, number] => [`${name}${suffix}`, 2]),
  ];
  return writers.map(([name, paths]) => {
    const real = (owner as Record<string, (...args: unknown[]) => unknown>)[name];
    return jest.spyOn(owner as never, name as never).mockImplementation(((...args: unknown[]) => {
      for (const target of args.slice(0, paths)) {
        if (!inside(root(), target)) {
          throw new Error(
            `HERMETIC GUARD: ${label}.${name} outside the temp folder: ${String(target)}`
          );
        }
      }
      return real.apply(owner, args) as unknown;
    }) as never);
  });
}

export function useHermeticHome(): HermeticHome {
  let root = "";
  const saved = new Map<string, string | undefined>();
  let spies: jest.SpyInstance[] = [];
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "copilot-home-"));
    const home = path.join(root, "home");
    fs.mkdirSync(home);
    for (const name of [...HOME_ENV, ...UNSET_ENV]) saved.set(name, process.env[name]);
    for (const name of HOME_ENV) process.env[name] = home;
    for (const name of UNSET_ENV) delete process.env[name];
    spies = [
      jest.spyOn(os, "homedir").mockReturnValue(home),
      ...guard(fs.promises, "fs.promises", () => root),
      ...guard(fs, "fs", () => root),
      ...guard(fs, "fs", () => root, "Sync"),
    ];
  });
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root: () => root, home: () => path.join(root, "home") };
}
