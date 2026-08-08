import type { Provider } from "@/modelManagement/types/persisted";

/**
 * A provider is self-hosted when its baseURL points at a host the user
 * controls: loopback, a private / link-local network, or a
 * `.local` / `.lan` / `.internal` name. Detected from the URL rather than
 * catalog membership so the answer stays correct even if a local runner
 * (Ollama, LM Studio) later gains a `models.dev` catalog entry.
 *
 * The one case this can't catch is a self-hosted endpoint deliberately
 * exposed on a public host — there is no signal in the URL to distinguish
 * it from a hosted cloud provider.
 */
export function isSelfHostedProvider(provider: Provider): boolean {
  return isSelfHostedUrl(provider.baseUrl);
}

/** `true` when `raw` resolves to a loopback / private / local-network host. */
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

  // IPv4-mapped IPv6 (::ffff:0:0/96). Node's URL parser normalizes
  // `::ffff:127.0.0.1` to the hex form `::ffff:7f00:1`, but accept the
  // dotted-decimal tail too in case a caller passes a pre-normalized value.
  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) return isPrivateIPv4(hexPairToDotted(mappedHex[1], mappedHex[2]));

  // IPv6 unique-local (fc00::/7 → fc/fd prefix) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;

  return false;
}

function isPrivateIPv4(host: string): boolean {
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!ipv4) return false;
  const a = Number(ipv4[1]);
  const b = Number(ipv4[2]);
  // 127/8 loopback, 10/8 private, 192.168/16 private, 172.16–31/12 private,
  // 169.254/16 link-local.
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

// Reconstruct dotted IPv4 from the two trailing hex groups of an
// IPv4-mapped IPv6 address (e.g. `7f00`,`1` → `127.0.0.1`).
function hexPairToDotted(high: string, low: string): string {
  const h = parseInt(high, 16);
  const l = parseInt(low, 16);
  return `${(h >> 8) & 0xff}.${h & 0xff}.${(l >> 8) & 0xff}.${l & 0xff}`;
}

/**
 * Pull the lowercased hostname out of a base URL, tolerating scheme-less
 * input (a pasted `localhost:11434`) and stripping IPv6 brackets. Returns
 * `null` when the value is empty or unparseable.
 */
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
