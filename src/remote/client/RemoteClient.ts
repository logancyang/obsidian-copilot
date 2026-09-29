import { openChannel, type OpenChannelOptions } from "@/remote/channel";
import type { RemoteChannel } from "@/remote/wire";
import { PairedDesktopStore, type PairedDesktop } from "@/remote/client/PairedDesktopStore";
import { trackRemoteEvent } from "@/remote/remoteEvents";
import { parsePairingLink, parsePairingParams, type PairingLinkParams } from "@/remote/pairingLink";

export type PairOutcome =
  | { ok: true; desktop: PairedDesktop }
  | { ok: false; reason: "wrong-vault"; vaultName: string }
  | {
      ok: false;
      reason:
        | "invalid-link"
        | "cancelled"
        | "unreachable"
        | "expired-or-used"
        | "desktop-failed"
        | "storage-failed"
        | "protocol";
    };

/**
 * What the person is asked to approve before this phone trusts a desktop: the name the link gives
 * the desktop (empty when it names none), the `host:port` the phone will connect to, the vault
 * name the link claims and the vault open on this phone. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export interface PairingConfirmation {
  desktopName: string;
  address: string;
  linkVaultName: string;
  openVaultName: string;
}

// `timedOut` separates a desktop that never answered (Tailscale off, or the desktop asleep) from
// one that refused the connection at once (Obsidian closed on a reachable machine).
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export type ConnectOutcome =
  | { ok: true; channel: RemoteChannel; deviceId: string }
  | { ok: false; reason: "unreachable"; timedOut: boolean }
  | { ok: false; reason: "token-rejected" }
  | { ok: false; reason: "protocol" };

// `clientId` is this phone's stable id, which lets the desktop replace an earlier pairing of the same
// phone, and `confirmPairing` resolves true when the person approves the desktop a link describes.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export interface RemoteClientDeps {
  store: PairedDesktopStore;
  vaultId: string;
  vaultName: string;
  deviceName: string;
  clientId: string;
  confirmPairing: (details: PairingConfirmation) => Promise<boolean>;
  now?: () => number;
  createId: () => string;
  channelOptions?: OpenChannelOptions;
}

function socketUrl(host: string, port: number): string {
  return `ws://${host}:${port}`;
}

export class RemoteClient {
  private readonly now: () => number;

  constructor(private readonly deps: RemoteClientDeps) {
    this.now = deps.now ?? Date.now;
  }

  get store(): PairedDesktopStore {
    return this.deps.store;
  }

  pairFromLink(link: string): Promise<PairOutcome> {
    return this.pair(parsePairingLink(link));
  }

  pairFromParams(params: Readonly<Record<string, string | undefined>>): Promise<PairOutcome> {
    return this.pair(parsePairingParams(params));
  }

  async connect(desktop: PairedDesktop): Promise<ConnectOutcome> {
    const result = await openChannel(
      socketUrl(desktop.host, desktop.port),
      { type: "auth", token: desktop.token },
      this.deps.channelOptions
    );
    if (result.ok) {
      return { ok: true, channel: result.channel, deviceId: result.reply.deviceId };
    }
    if (result.reason === "denied") return { ok: false, reason: "token-rejected" };
    if (result.reason === "protocol") return { ok: false, reason: "protocol" };
    return { ok: false, reason: "unreachable", timedOut: result.reason === "timeout" };
  }

  private async pair(params: PairingLinkParams | null): Promise<PairOutcome> {
    const outcome = await this.pairUntracked(params);
    trackRemoteEvent(
      outcome.ok
        ? { name: "remote_pair_completed" }
        : { name: "remote_pair_failed", reason: outcome.reason }
    );
    return outcome;
  }

  private async pairUntracked(params: PairingLinkParams | null): Promise<PairOutcome> {
    if (!params) return { ok: false, reason: "invalid-link" };
    // A link scanned while another vault is open lands here, and pairing it would store a
    // token under the wrong vault. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    if (params.vaultId !== this.deps.vaultId) {
      return { ok: false, reason: "wrong-vault", vaultName: params.vaultName };
    }
    // A link can come from any web page or message, and pairing hands this phone's session traffic
    // to the desktop it names, so the person approves that desktop first. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    const approved = await this.deps.confirmPairing({
      desktopName: params.desktopName,
      address: `${params.host}:${params.port}`,
      linkVaultName: params.vaultName,
      openVaultName: this.deps.vaultName,
    });
    if (!approved) return { ok: false, reason: "cancelled" };
    const result = await openChannel(
      socketUrl(params.host, params.port),
      {
        type: "pair",
        secret: params.secret,
        deviceName: this.deps.deviceName,
        clientId: this.deps.clientId,
      },
      this.deps.channelOptions
    );
    if (!result.ok) {
      if (result.reason === "denied") {
        // The desktop also answers bad-request when it could not save the new device. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
        return {
          ok: false,
          reason: result.denyReason === "pairing-rejected" ? "expired-or-used" : "desktop-failed",
        };
      }
      return { ok: false, reason: result.reason === "protocol" ? "protocol" : "unreachable" };
    }
    result.channel.close();
    if (result.reply.type !== "paired") return { ok: false, reason: "protocol" };
    const desktop: PairedDesktop = {
      id: this.deps.createId(),
      host: params.host,
      port: params.port,
      token: result.reply.token,
      desktopName: result.reply.desktopName,
      vaultName: params.vaultName,
      pairedAt: this.now(),
    };
    // The desktop has already spent the secret and saved this phone, so a failure to keep the token
    // here has to reach the person. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    try {
      this.deps.store.add(desktop);
    } catch {
      return { ok: false, reason: "storage-failed" };
    }
    return { ok: true, desktop };
  }
}
