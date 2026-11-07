let previousCall: Promise<unknown> = Promise.resolve();

// An approved-rules list must not read an agent's rules before a pending removal lands, and two
// quick removals must not both rewrite the same text.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/868
export function oneAtATime<T>(call: () => Promise<T>): Promise<T> {
  const result = previousCall.then(call);
  previousCall = result.catch(() => undefined);
  return result;
}
