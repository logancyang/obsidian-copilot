import type { PairingConfirmation } from "@/remote/client/RemoteClient";
import React from "react";

export interface PairingConfirmContentProps {
  details: PairingConfirmation;
}

// A pairing link can arrive from any web page or message, so the dialog shows where the phone will
// connect and what it will trust before anything is sent.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/610
export const PairingConfirmContent: React.FC<PairingConfirmContentProps> = ({ details }) => {
  const namesAnotherVault =
    details.linkVaultName !== "" && details.linkVaultName !== details.openVaultName;
  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-text-sm">
      <p className="tw-m-0">
        This phone will trust this desktop with your agent sessions. Continue only if you just
        scanned this code in Copilot settings under Remote on your own computer.
      </p>
      <dl className="tw-m-0 tw-grid tw-grid-cols-[auto_1fr] tw-gap-x-3 tw-gap-y-1">
        <dt className="tw-text-muted">Desktop</dt>
        <dd className="tw-m-0 tw-break-all tw-font-medium">
          {details.desktopName || "Unnamed desktop"}
        </dd>
        <dt className="tw-text-muted">Address</dt>
        <dd className="tw-m-0 tw-break-all tw-font-mono">{details.address}</dd>
        <dt className="tw-text-muted">Vault open here</dt>
        <dd className="tw-m-0 tw-break-all tw-font-medium">{details.openVaultName}</dd>
        {namesAnotherVault && (
          <>
            <dt className="tw-text-muted">Vault in the link</dt>
            <dd className="tw-m-0 tw-break-all tw-font-medium">{details.linkVaultName}</dd>
          </>
        )}
      </dl>
    </div>
  );
};
