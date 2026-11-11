const PYTHON_UTF8_ENV: Readonly<Record<string, string>> = Object.freeze({ PYTHONUTF8: "1" });
const NO_PYTHON_UTF8_ENV: Readonly<Record<string, string>> = Object.freeze({});

// Python on a Windows GBK code page raised UnicodeEncodeError printing note text; a value the user set still wins.
// https://github.com/logancyang/obsidian-copilot/issues/3867
export function pythonUtf8Env(
  envOverrides?: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
  inherited: NodeJS.ProcessEnv = process.env
): Readonly<Record<string, string>> {
  return platform === "win32" &&
    inherited.PYTHONUTF8 === undefined &&
    envOverrides?.PYTHONUTF8 === undefined
    ? PYTHON_UTF8_ENV
    : NO_PYTHON_UTF8_ENV;
}
