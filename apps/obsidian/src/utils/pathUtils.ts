export function normalizeAbsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function joinPosix(a: string, b: string): string {
  const left = a.replace(/\/+$/, "");
  const right = b.replace(/^\/+/, "");
  return left.length === 0 ? right : `${left}/${right}`;
}

export function parentDir(p: string): string {
  const stripped = p.replace(/\/+$/, "");
  const idx = stripped.lastIndexOf("/");
  if (idx <= 0) return "/";
  return stripped.slice(0, idx);
}

export function basename(p: string): string {
  const stripped = normalizeAbsPath(p);
  const idx = stripped.lastIndexOf("/");
  return idx === -1 ? stripped : stripped.slice(idx + 1);
}

export function resolvesInto(targetAbs: string, rootAbs: string): boolean {
  const t = normalizeAbsPath(targetAbs);
  const r = normalizeAbsPath(rootAbs);
  return t === r || t.startsWith(r + "/");
}

export function collapseHomeDir(
  absolutePath: string,
  homeDir: string,
  caseInsensitive = false
): string {
  if (!absolutePath || !homeDir) return absolutePath;
  const normHome = homeDir.replace(/[/\\]+$/, "");
  if (!normHome) return absolutePath;

  const normHomeFwd = normHome.replace(/\\/g, "/");
  const headFwd = absolutePath.slice(0, normHome.length).replace(/\\/g, "/");
  const matches = caseInsensitive
    ? headFwd.toLowerCase() === normHomeFwd.toLowerCase()
    : headFwd === normHomeFwd;
  if (!matches) return absolutePath;

  const rest = absolutePath.slice(normHome.length);
  if (rest === "") return "~";
  if (rest[0] === "/" || rest[0] === "\\") return "~" + rest;
  return absolutePath;
}
