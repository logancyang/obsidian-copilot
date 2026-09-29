import type { RemoteBanner, RemoteScreen } from "@/agentMode/mobile/remoteStatus";

export interface ScreenCopy {
  title: string;
  detail: string;
  tone: "neutral" | "error";
  busy: boolean;
  canRetry: boolean;
}

export function describeScreen(screen: RemoteScreen, desktopName: string): ScreenCopy {
  switch (screen.kind) {
    case "connecting":
      return {
        title: `Connecting to ${desktopName}`,
        detail: "This can take a few seconds.",
        tone: "neutral",
        busy: true,
        canRetry: false,
      };
    case "syncing":
      return {
        title: `Loading sessions from ${desktopName}`,
        detail: "Connected. Waiting for the desktop's agent tabs.",
        tone: "neutral",
        busy: true,
        canRetry: false,
      };
    case "unreachable":
      return {
        title: "Can't reach your desktop. Is Tailscale on?",
        detail: `Check that Tailscale is running on this phone and on ${desktopName}, and that ${desktopName} is awake.`,
        tone: "error",
        busy: false,
        canRetry: true,
      };
    case "offline":
      return {
        title: `${desktopName} is offline`,
        detail: `Open Obsidian on ${desktopName} and keep it awake. Copilot retries on its own.`,
        tone: "error",
        busy: false,
        canRetry: true,
      };
    case "protocol":
      return {
        title: `${desktopName} sent an unexpected reply`,
        detail: "Update Copilot on both devices, then try again.",
        tone: "error",
        busy: false,
        canRetry: true,
      };
    case "denied":
      return {
        title: `${desktopName} no longer accepts this phone`,
        detail:
          "The desktop revoked this phone. Remove the desktop in Copilot settings under Remote, then pair again.",
        tone: "error",
        busy: false,
        canRetry: false,
      };
    case "version_mismatch": {
      const remote = screen.remote
        ? `${desktopName} runs Copilot ${screen.remote.app} (protocol ${screen.remote.protocol})`
        : `${desktopName} runs a different version of Copilot`;
      return {
        title: "Update Copilot on both devices",
        detail: `This phone runs Copilot ${screen.local.app} (protocol ${screen.local.protocol}). ${remote}. Both need the same version to work together.`,
        tone: "error",
        busy: false,
        canRetry: false,
      };
    }
  }
}

export function describeBanner(banner: RemoteBanner, desktopName: string): string {
  switch (banner) {
    case "reconnecting":
      return `Reconnecting to ${desktopName}…`;
    case "offline":
      return `${desktopName} is offline. Retrying…`;
    case "unreachable":
      return "Can't reach your desktop. Is Tailscale on?";
    case "protocol":
      return `${desktopName} sent an unexpected reply. Retrying…`;
  }
}
