import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { requireNodeModule } from "@/utils/desktopRuntime";

const STALL_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export interface DownloadFileOptions {
  /** Names the download in error messages. */
  displayName: string;
  /** Exact size the release publishes; any other size fails the download. */
  bytes: number;
  /** SHA-256 hex digest the release publishes, when it provides one. */
  sha256?: string;
  signal: AbortSignal;
  /** Receives received bytes at most once per whole percent. */
  onProgress?: (received: number, total: number) => void;
}

/**
 * Streams a managed release asset to a new file, verifying its published size
 * and digest. Follows HTTPS redirects only and fails a connection that stops
 * sending data, so an installation neither runs an unverified file nor waits
 * forever on a dead network.
 *
 * @param url - HTTPS address of the asset.
 * @param dest - File to create; an existing file fails the download.
 * @param options - Expected size and digest, cancellation, and byte progress.
 */
export async function downloadFile(
  url: string,
  dest: string,
  options: DownloadFileOptions
): Promise<void> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const https = requireNodeModule<typeof import("node:https")>("https");
  const crypto = requireNodeModule<typeof import("node:crypto")>("crypto");
  const { displayName, bytes, sha256, signal, onProgress } = options;
  if (signal.aborted) throw new ManagedInstallAbortError();
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    const get = (current: string, hops: number): void => {
      const req = https.get(current, { signal }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && hops > 0) {
          res.resume();
          const next = new URL(res.headers.location, current);
          // A downgraded redirect would let the network substitute the release asset.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
          if (next.protocol !== "https:") {
            reject(new Error(`Unsafe ${displayName} download redirect.`));
            return;
          }
          get(next.href, hops - 1);
        } else if (status === 200) resolve(res);
        else {
          res.resume();
          reject(new Error(`${displayName} download failed: HTTP ${status}`));
        }
      });
      req.setTimeout(STALL_TIMEOUT_MS, () =>
        req.destroy(new Error(`${displayName} download stalled. Check your network and retry.`))
      );
      req.on("error", reject);
    };
    get(url, MAX_REDIRECTS);
  });
  const hash = crypto.createHash("sha256");
  let received = 0;
  let reportedPercent = 0;
  onProgress?.(received, bytes);
  const output = await fs.promises.open(dest, "wx");
  try {
    for await (const chunk of response as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > bytes) throw new Error(`${displayName} download size mismatch.`);
      hash.update(chunk);
      await output.writeFile(chunk);
      // Large archives need visible byte progress without rerendering for every network chunk.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/578
      const percent = Math.floor((received / bytes) * 100);
      if (percent !== reportedPercent) {
        reportedPercent = percent;
        onProgress?.(received, bytes);
      }
    }
  } catch (error) {
    // Cancelling destroys the socket mid-transfer; report the cancellation, not a network failure.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
    if (signal.aborted) throw new ManagedInstallAbortError();
    throw error;
  } finally {
    response.destroy();
    await output.close();
  }
  if (received !== bytes) throw new Error(`${displayName} download size mismatch.`);
  if (sha256 && hash.digest("hex") !== sha256)
    throw new Error(`${displayName} download checksum mismatch.`);
}
