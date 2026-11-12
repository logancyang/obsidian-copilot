export const RECORDED_STREAM: readonly (readonly [number, string])[] = Object.freeze([
  [0, "Here is how the two setups"],
  [31, " compare.\n\n```copilot"],
  [345, "-ui\n<stack><"],
  [345, 'grid columns="2"><'],
  [345, 'card title="Local" icon'],
  [345, '="hard-drive" description'],
  [345, '="On this device"><text>'],
  [345, "Private and works offline.</"],
  [345, "text><badge>Fast"],
  [345, "</badge></card><card title"],
  [346, '="Cloud" icon'],
  [363, '="cloud" description="'],
  [397, 'Synced service"><text>'],
  [429, "Available on every device you sign in"],
  [694, " to.</text><badge>"],
  [694, "Shared</badge></card"],
  [694, "></grid><steps><step"],
  [694, ' title="Pick a folder'],
  [694, '">Choose where the vault'],
  [694, " lives.</step><step title"],
  [694, '="Turn on sync">'],
  [696, "Connect the service you trust"],
  [730, '.</step><step title="'],
  [763, 'Check a second device">Open the'],
  [798, " vault there and confirm not"],
  [830, "es appear.</step></ste"],
  [1189, "ps></stack>\n```"],
  [1189, "\n\nPick local when privacy"],
  [1189, " matters most."],
]);

export interface RecordedFence {
  body: string;
  closed: boolean;
}

export function recordedFenceAt(ms: number): RecordedFence {
  const text = RECORDED_STREAM.filter(([at]) => at <= ms)
    .map(([, chunk]) => chunk)
    .join("");
  const start = text.indexOf("```copilot-ui\n");
  if (start < 0) return { body: "", closed: false };
  const body = text.slice(start + "```copilot-ui\n".length);
  const end = body.indexOf("\n```");
  return end < 0 ? { body, closed: false } : { body: body.slice(0, end), closed: true };
}

export const RECORDED_STREAM_END = RECORDED_STREAM[RECORDED_STREAM.length - 1][0];
