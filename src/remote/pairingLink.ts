import { isTailscaleIPv4 } from "@/remote/address";

export const PAIRING_ACTION = "copilot-pair";

const VAULT_ID_RE = /^[a-f0-9]{8}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_VAULT_NAME_LENGTH = 256;
const MAX_DESKTOP_NAME_LENGTH = 60;
// eslint-disable-next-line no-control-regex -- strips control characters from a name in a link another device built
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export interface PairingLinkParams {
  host: string;
  port: number;
  vaultName: string;
  vaultId: string;
  secret: string;
  /** The desktop's own name, shown to the person on the phone before they pair. https://github.com/Brevilabs/obsidian-copilot-private/issues/610 */
  desktopName: string;
}

export function buildPairingLink(params: PairingLinkParams): string {
  const query = new URLSearchParams({
    host: params.host,
    port: String(params.port),
    vault: params.vaultName,
    vaultId: params.vaultId,
    secret: params.secret,
    desktop: params.desktopName,
  });
  return `obsidian://${PAIRING_ACTION}?${query.toString()}`;
}

/**
 * Validates the query values of a pairing link. A link that names a host outside the Tailscale
 * range is rejected so a pasted or forged link can never point the phone at a LAN or internet
 * address. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export function parsePairingParams(
  raw: Readonly<Record<string, string | undefined>>
): PairingLinkParams | null {
  const { host, port: portText, vault, vaultId, secret, desktop } = raw;
  if (!host || !isTailscaleIPv4(host)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (!vaultId || !VAULT_ID_RE.test(vaultId)) return null;
  if (!secret || !SECRET_RE.test(secret)) return null;
  const vaultName = (vault ?? "").slice(0, MAX_VAULT_NAME_LENGTH);
  const desktopName = (desktop ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .slice(0, MAX_DESKTOP_NAME_LENGTH);
  return { host, port, vaultName, vaultId, secret, desktopName };
}

export function parsePairingLink(link: string): PairingLinkParams | null {
  const trimmed = link.trim();
  const prefix = `obsidian://${PAIRING_ACTION}?`;
  if (!trimmed.startsWith(prefix)) return null;
  const query = new URLSearchParams(trimmed.slice(prefix.length));
  return parsePairingParams(Object.fromEntries(query.entries()));
}
