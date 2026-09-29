import { isTailscaleIPv4 } from "@/remote/address";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

export type NetworkInterfaces = Record<string, readonly InterfaceAddress[] | undefined>;

// Tailscale's adapter is `utunN` on macOS, `tailscale0` on Linux and `Tailscale` on Windows. An
// address in 100.64.0.0/10 on any other adapter is a carrier-grade NAT or LAN address and must
// not be bound. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
const TAILSCALE_INTERFACE = /^utun\d+$|tailscale/i;
const MACOS_TUNNEL_INTERFACE = /^utun\d+$/;

// macOS names every VPN tunnel `utunN`, and some VPNs also hand out 100.64.0.0/10 addresses.
// Tailscale always assigns its adapter an address in fd7a:115c:a1e0::/48 as well.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
const TAILSCALE_IPV6_PREFIX = "fd7a:115c:a1e0:";

function isTailscaleAdapter(name: string, entries: readonly InterfaceAddress[]): boolean {
  if (!MACOS_TUNNEL_INTERFACE.test(name)) return true;
  return entries.some(
    (entry) => !entry.internal && entry.address.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX)
  );
}

export function selectTailscaleAddress(interfaces: NetworkInterfaces): string | null {
  const names = Object.keys(interfaces)
    .filter(
      (name) => TAILSCALE_INTERFACE.test(name) && isTailscaleAdapter(name, interfaces[name] ?? [])
    )
    .sort();
  for (const name of names) {
    for (const entry of interfaces[name] ?? []) {
      const isIPv4 = entry.family === "IPv4" || entry.family === 4;
      if (isIPv4 && !entry.internal && isTailscaleIPv4(entry.address)) return entry.address;
    }
  }
  return null;
}

export function readTailscaleAddress(): string | null {
  const os = requireNodeModule<typeof import("node:os")>("os");
  return selectTailscaleAddress(os.networkInterfaces());
}
