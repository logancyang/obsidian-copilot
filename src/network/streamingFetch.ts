export type StreamingFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Return the active Obsidian window's native fetch implementation for APIs
 * whose response bodies must remain stream-readable. `requestUrl` buffers the
 * response and therefore cannot implement these provider streaming contracts.
 *
 * @returns A fetch-compatible function bound to the active window.
 */
export function getNativeStreamingFetch(): StreamingFetch {
  return (input, init) => activeWindow.fetch(input, init);
}
