import { describePairOutcome } from "@/remote/client/pairMessages";
import type { RemoteClient } from "@/remote/client/RemoteClient";

export async function handlePairingLinkAction(
  client: RemoteClient | undefined,
  params: Readonly<Record<string, string | undefined>>,
  notify: (message: string) => void
): Promise<void> {
  if (!client) {
    notify("Open this pairing link on your phone. Pairing runs in Obsidian mobile.");
    return;
  }
  notify(describePairOutcome(await client.pairFromParams(params)));
}
