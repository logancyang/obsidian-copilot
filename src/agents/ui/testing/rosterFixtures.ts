import type { CustomAgent } from "@/agents/CustomAgentStore";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";

const SKIN = ["#e8c39e", "#c99a76", "#f0d2b4", "#8d6748", "#e2b896", "#b98c6a", "#f3d6bf"];
const SHIRT = ["#5a7bb5", "#b5675a", "#6aa77a", "#c9a24a", "#8a6cc9", "#4fb3b0", "#d47aa8"];
const BACKDROP = ["#2f3a4d", "#4a3433", "#2d4236", "#4a4128", "#382f4c", "#233f40", "#47303e"];

function faceSrc(index: number): string {
  const i = index % SKIN.length;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BACKDROP[i]}"/>` +
    `<circle cx="32" cy="25" r="12" fill="${SKIN[i]}"/><path d="M8 64c0-14 11-23 24-23s24 9 24 23z" fill="${SHIRT[i]}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function fixtureAgent(name: string, title: string, index: number): CustomAgent {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-");
  return { slug, name, title, instruction: "", faceSrc: faceSrc(index) } as CustomAgent;
}

export const COCO = fixtureAgent("Coco", "Keeps the whole vault in view", 0);
export const MAYA = fixtureAgent("Maya", "Product critic. Pushes back on plans", 1);
export const LEO = fixtureAgent("Leo", "Keeps the company books", 2);
export const NORA = fixtureAgent("Nora", "Family calendar and school logistics", 3);
export const KAI = fixtureAgent("Kai", "Writes launch posts and the newsletter", 4);
export const THREE_AGENTS = [COCO, MAYA, LEO];
export const FIVE_AGENTS = [...THREE_AGENTS, NORA, KAI];
export const TWELVE_AGENTS = [
  ...FIVE_AGENTS,
  fixtureAgent("Ada", "Reads every paper so you don't have to", 5),
  fixtureAgent("Bo", "Plans trips down to the train platform", 6),
  fixtureAgent("Cy", "Keeps the garden journal", 0),
  fixtureAgent("Di", "Answers support email in your voice", 1),
  fixtureAgent("Ed", "Turns meeting notes into tasks", 2),
  fixtureAgent("Fay", "Drafts grant applications", 3),
  fixtureAgent("Gus", "Tracks the home renovation budget", 4),
];
export const LONG_NAMED_AGENT = fixtureAgent(
  "Nora · Family & School",
  "Family calendar and school logistics, from pickups to permission slips and the winter break rota",
  3
);

const NOW = Date.parse("2026-11-16T15:20:00Z");
const MINUTE = 60_000;

function fixtureChat(index: number, title: string, agent: string | undefined, minutesAgo: number) {
  const at = new Date(NOW - minutesAgo * MINUTE);
  return { id: `chat-${index}`, title, agent, createdAt: at, lastAccessedAt: at };
}

export const RECENT_CHATS: ChatHistoryItem[] = [
  fixtureChat(0, "Draft the 4.0.21 release notes from merged PRs", undefined, 0),
  fixtureChat(1, "What to cut from the launch video", "maya", 5),
  fixtureChat(2, "Plan the 4.0.21 launch video, 90 seconds max", "coco", 60),
  fixtureChat(3, "What's left on the November plan?", "coco", 120),
  fixtureChat(4, "Reconcile October expenses against Mercury", "leo", 3 * 1440),
  fixtureChat(5, "Kids' winter break: who picks up when", "nora", 4 * 1440),
  fixtureChat(6, "Summarize last week's user interviews", undefined, 5 * 1440),
];
