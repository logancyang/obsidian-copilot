import type { SessionHost } from "@/agentMode/session/host/SessionHost";
import { SessionClient } from "@copilot/protocol/client";
import { findNonPlainField } from "@copilot/protocol/plainData";

export function connectInProcess(
  host: Pick<SessionHost, "connect">,
  options: { checkFrames: boolean }
): SessionClient {
  const carry = options.checkFrames ? checkedFrame : <F>(frame: F): F => frame;
  const client = new SessionClient((frame) => toHost(carry(frame)));
  const toHost = host.connect((frame) => client.receive(carry(frame)));
  return client;
}

// The in-process path hands objects over uncopied, so outside production it refuses what JSON could not carry and freezes what it hands over. https://github.com/Brevilabs/obsidian-copilot-private/issues/1003
function checkedFrame<F>(frame: F): F {
  const nonPlain = findNonPlainField(frame);
  if (nonPlain) {
    throw new Error(
      `A chat protocol frame holds ${nonPlain.found} at "${nonPlain.path}", which cannot cross to another process.`
    );
  }
  return deepFreeze(frame);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  for (const field of Object.values(value)) deepFreeze(field);
  return value;
}
