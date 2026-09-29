import { openChannel, type OpenChannelOptions } from "@/remote/channel";
import type { RemoteChannel } from "@/remote/wire";
import { PairedDesktopStore, type PairedDesktop } from "@/remote/client/PairedDesktopStore";
import { parsePairingLink, parsePairingParams, type PairingLinkParams } from "@/remote/pairingLink";

export type PairOutcome =
  | { ok: true; desktop: PairedDesktop }
  | { ok: false; reason: "wrong-vault"; vaultName: string }
  | { ok: false; reason: "invalid-link" | "unreachable" | "expired-or-used" | "protocol" };

export type ConnectOutcome =
  | { ok: true; channel: RemoteChannel; deviceId: string }
  | { ok: false; reason: "unreachable" | "token-rejected" | "protocol" };

export interface RemoteClientDeps {
  store: PairedDesktopStore;
  vaultId: string;
  deviceName: string;
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
    return { ok: false, reason: result.reason === "protocol" ? "protocol" : "unreachable" };
  }

  private async pair(params: PairingLinkParams | null): Promise<PairOutcome> {
    if (!params) return { ok: false, reason: "invalid-link" };
    // A link scanned while another vault is open lands here, and pairing it would store a
    // token under the wrong vault. https://github.com/Brevilabs/obsidian-copilot-private/issues/610
    if (params.vaultId !== this.deps.vaultId) {
      return { ok: false, reason: "wrong-vault", vaultName: params.vaultName };
    }
    const result = await openChannel(
      socketUrl(params.host, params.port),
      { type: "pair", secret: params.secret, deviceName: this.deps.deviceName },
      this.deps.channelOptions
    );
    if (!result.ok) {
      if (result.reason === "denied") return { ok: false, reason: "expired-or-used" };
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
    this.deps.store.add(desktop);
    return { ok: true, desktop };
  }
}
