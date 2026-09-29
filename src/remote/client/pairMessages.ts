import type { PairOutcome } from "@/remote/client/RemoteClient";

export function describePairOutcome(outcome: PairOutcome): string {
  if (outcome.ok) return `Paired with ${outcome.desktop.desktopName}.`;
  switch (outcome.reason) {
    case "invalid-link":
      return "That is not a valid Copilot pairing link. Copy it again from the desktop's Remote settings.";
    case "wrong-vault":
      return outcome.vaultName
        ? `This link is for the vault "${outcome.vaultName}". Open that vault on this phone, then scan again.`
        : "This link is for a different vault. Open that vault on this phone, then scan again.";
    case "unreachable":
      return "Can't reach your desktop. Check that Tailscale is on for both devices and that Obsidian is open on the desktop.";
    case "expired-or-used":
      return "This pairing code has expired or was already used. Create a new one on the desktop.";
    case "protocol":
      return "The desktop replied in a way this version of Copilot does not understand. Update Copilot on both devices.";
  }
}
