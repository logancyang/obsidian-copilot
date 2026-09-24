import { formatBytes } from "@/utils/formatBytes";

/** Display-ready progress for one managed binary installation. */
export interface ManagedInstallProgress {
  label: string;
  percent: number;
}

const ELAPSED_TICK_MS = 5_000;
const DOWNLOAD_START_PERCENT = 10;
const DOWNLOAD_END_PERCENT = 75;

/**
 * Describes one managed installation as display-ready progress so every backend
 * shows the same phases. Phases without a measurable amount of work report
 * elapsed seconds, and downloads report transferred bytes, so a slow network or
 * device never leaves the progress looking frozen. Owns only the progress
 * wording and its timer; the manager decides where progress is published.
 */
export class InstallProgressReporter {
  private ticker: number | null = null;

  /**
   * @param displayName - Name of the installed binary as shown to the user.
   * @param publish - Receives every progress update, including elapsed-time refreshes.
   */
  constructor(
    private readonly displayName: string,
    private readonly publish: (progress: ManagedInstallProgress) => void
  ) {}

  connecting(): void {
    this.phase(`Connecting to ${this.displayName} download…`, 5);
  }

  download(received: number, total: number): void {
    this.stopTicker();
    const fraction = Math.min(1, received / total);
    this.publish({
      label: `Downloading ${this.displayName} — ${formatBytes(received)} / ${formatBytes(total)}`,
      percent:
        DOWNLOAD_START_PERCENT +
        Math.floor(fraction * (DOWNLOAD_END_PERCENT - DOWNLOAD_START_PERCENT)),
    });
  }

  extracting(): void {
    this.phase(`Extracting ${this.displayName}…`, 80);
  }

  /** @param subject - Part being verified when a bundle checks more than the binary itself. */
  verifying(subject = this.displayName): void {
    this.phase(`Verifying ${subject}…`, 90);
  }

  activating(): void {
    this.phase(`Activating ${this.displayName}…`, 98);
  }

  done(): void {
    this.stopTicker();
    this.publish({ label: `${this.displayName} ready.`, percent: 100 });
  }

  /** Stops elapsed-time updates once the installation settles. */
  dispose(): void {
    this.stopTicker();
  }

  private phase(label: string, percent: number): void {
    this.stopTicker();
    this.publish({ label, percent });
    const startedAt = Date.now();
    // Release lookups, redirects, extraction, and first-run security scans can each take minutes.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/578
    this.ticker = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      this.publish({ label: `${label} ${seconds}s elapsed`, percent });
    }, ELAPSED_TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
  }
}
