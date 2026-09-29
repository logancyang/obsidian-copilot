import { ConfirmModal } from "@/components/modals/ConfirmModal";
import type { PairingConfirmation } from "@/remote/client/RemoteClient";
import { PairingConfirmContent } from "@/remote/ui/PairingConfirmContent";
import type { App } from "obsidian";
import React from "react";

/**
 * Asks the person whether this phone may pair with the desktop a pairing link describes. Closing
 * the dialog any other way than choosing Pair counts as declining.
 *
 * @param app - The Obsidian app the dialog opens in.
 * @param details - The desktop, address and vaults the person is asked to approve.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/610
 */
export function confirmPairing(app: App, details: PairingConfirmation): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(
      app,
      () => resolve(true),
      <PairingConfirmContent details={details} />,
      "Pair with this desktop?",
      "Pair",
      "Cancel",
      () => resolve(false)
    ).open();
  });
}
