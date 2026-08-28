import { resolveAntigravityBinary } from "./antigravityBinaryResolver";

describe("resolveAntigravityBinary", () => {
  const base = {
    homeDir: "C:\\Users\\me",
    platform: "win32" as NodeJS.Platform,
    env: {} as NodeJS.ProcessEnv,
    fs: {
      existsSync: jest.fn((path: string) => path.endsWith("agy.exe")),
      readFileSync: jest.fn(),
      readdirSync: jest.fn(() => []),
    },
  };

  it("prefers an existing configured path", () => {
    const configured = "D:\\tools\\agy.exe";
    const fs = { ...base.fs, existsSync: jest.fn((path: string) => path === configured) };

    expect(resolveAntigravityBinary({ ...base, override: configured, fs })).toBe(configured);
  });

  it("detects the official Windows local install location", () => {
    const fs = {
      ...base.fs,
      existsSync: jest.fn(
        (path: string) => path === "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe"
      ),
    };

    expect(resolveAntigravityBinary({ ...base, fs })).toBe(
      "C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe"
    );
  });

  it("does not return a missing configured path", () => {
    const fs = { ...base.fs, existsSync: jest.fn(() => false) };

    expect(resolveAntigravityBinary({ ...base, override: "D:\\missing\\agy.exe", fs })).toBeNull();
  });
});
