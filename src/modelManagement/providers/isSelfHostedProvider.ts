import type { Provider } from "@/modelManagement/types/persisted";

export function isSelfHostedProvider(provider: Provider): boolean {
  return isSelfHostedUrl(provider.baseUrl);
}

export function isSelfHostedUrl(raw: string | undefined): boolean {
  const host = parseHost(raw);
  if (!host) return false;

  if (host === "localhost" || host === "0.0.0.0" || host === "::" || host === "::1") {
    return true;
  }
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  if (isPrivateIPv4(host)) return true;

  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) return isPrivateIPv4(hexPairToDotted(mappedHex[1], mappedHex[2]));

  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  return false;
}

function isPrivateIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function hexPairToDotted(high: string, low: string): string {
  const h = parseInt(high, 16);
  const l = parseInt(low, 16);
  return `${(h >> 8) & 0xff}.${h & 0xff}.${(l >> 8) & 0xff}.${l & 0xff}`;
}

function parseHost(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const hostname = tryParseHostname(trimmed) ?? tryParseHostname(`http://${trimmed}`);
  if (!hostname) return null;

  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function tryParseHostname(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}
