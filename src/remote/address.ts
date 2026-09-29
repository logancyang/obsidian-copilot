// Octets are canonical decimals: the WebSocket URL parser reads a leading zero as octal, so
// "100.077.0.1" would connect to 100.63.0.1 while a numeric range check saw 100.77.0.1.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
const CANONICAL_IPV4 = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export function isTailscaleIPv4(address: string): boolean {
  const match = CANONICAL_IPV4.exec(address);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
