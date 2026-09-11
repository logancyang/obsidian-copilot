import type { VoiceSourceRange } from "@/agentMode/session/voiceTypes";
import type { VoiceTranscriptDelta } from "@/agentMode/voice/types";

/**
 * One readable row of the spoken conversation: adjacent fragments from the
 * same speaker, assembled into a caption. Fragment ids and audio ranges are
 * kept so a late fragment can still be matched to the row it amends.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Transcript assembly".
 */
export interface VoiceTranscriptGroup {
  readonly groupId: string;
  readonly role: "user" | "assistant";
  /** Every fragment joined verbatim, with only the outer whitespace trimmed. */
  readonly text: string;
  readonly ranges: readonly VoiceSourceRange[];
}

/** What one ingested fragment did to the transcript. */
export interface VoiceTranscriptChange {
  readonly group: VoiceTranscriptGroup;
  /** True when this fragment opened a new row rather than extending one. */
  readonly created: boolean;
}

/** The speech a delegation may turn into a task, and where it came from. */
export interface VoiceSpeechClaim {
  /** The request text, assembled from every unclaimed user fragment. */
  readonly text: string;
  /** Rows the text was read from, so the task can link the entries it answers. */
  readonly groupIds: readonly string[];
  /** Fragment ids now claimed; a second delegation cannot claim them again. */
  readonly fragmentIds: readonly string[];
}

interface Fragment {
  fragmentId: string;
  delta: string;
  startMs: number;
  endMs: number;
  claimed: boolean;
}

interface MutableGroup {
  groupId: string;
  role: "user" | "assistant";
  fragments: Fragment[];
  /** A sealed row never absorbs new speech: the next fragment starts a row. */
  sealed: boolean;
}

/**
 * Assembles GPT-Live transcript fragments into readable rows and tracks which
 * speech a task has already claimed.
 *
 * Fragments are not turns: they arrive split mid-word, occasionally out of
 * order, and sometimes after the row they belong to was already shown. This
 * owns that mess so the conversation store only ever sees a finished caption.
 * Grouping is presentation — it never authorizes work.
 *
 * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "Transcript assembly".
 */
export class VoiceTranscriptAssembler {
  private readonly groups: MutableGroup[] = [];
  // Deduplication is scoped to one call: fragment ids are unique within a live
  // session, and a reconnect is a new identity that never replays old events.
  private readonly seenFragmentIds = new Set<string>();
  private nextGroupIndex = 0;

  /**
   * Fold one fragment into the transcript. Returns the row to render, or null
   * when the fragment was already seen — a resent event must not duplicate
   * text the user is already reading.
   *
   * @param delta - A fragment exactly as the provider delivered it.
   */
  ingest(delta: VoiceTranscriptDelta): VoiceTranscriptChange | null {
    if (this.seenFragmentIds.has(delta.liveEventId)) return null;
    this.seenFragmentIds.add(delta.liveEventId);
    const fragment: Fragment = {
      fragmentId: delta.liveEventId,
      delta: delta.delta,
      startMs: delta.startMs,
      endMs: delta.endMs,
      claimed: false,
    };
    const target = this.resolveGroup(delta.role, fragment);
    insertInAudioOrder(target.group, fragment);
    return { group: snapshot(target.group), created: target.created };
  }

  /** Whether the call contains usable user text, regardless of its task ownership. */
  hasUserSpeech(): boolean {
    return this.groups.some(
      (group) => group.role === "user" && group.fragments.some((fragment) => fragment.delta.trim())
    );
  }

  /**
   * Take the user speech no task owns yet. Returns null when every fragment is
   * already claimed, so a repeated delegation cannot run the same request
   * twice. Claiming also seals the rows, so later speech becomes its own row
   * and its own request.
   *
   * See `designdocs/VOICE_CHAT_DEMO_DESIGN.md`, "From speech to a local task".
   */
  claimUserSpeech(): VoiceSpeechClaim | null {
    const groupIds: string[] = [];
    const fragmentIds: string[] = [];
    const parts: string[] = [];
    for (const group of this.groups) {
      if (group.role !== "user") continue;
      const unclaimed = group.fragments.filter((fragment) => !fragment.claimed);
      if (unclaimed.length === 0) continue;
      groupIds.push(group.groupId);
      for (const fragment of unclaimed) {
        fragment.claimed = true;
        fragmentIds.push(fragment.fragmentId);
      }
      parts.push(assembleText(group.fragments));
      group.sealed = true;
    }
    const text = parts.join(" ").trim();
    if (text.length === 0) return null;
    return { text, groupIds, fragmentIds };
  }

  /** The assistant row still being spoken into, if any. */
  getOpenAssistantGroupId(): string | null {
    for (let i = this.groups.length - 1; i >= 0; i -= 1) {
      const group = this.groups[i];
      if (group.role !== "assistant") continue;
      return group.sealed ? null : group.groupId;
    }
    return null;
  }

  /**
   * Decide which row a fragment belongs to: the open row of the same speaker,
   * an earlier row the fragment overlaps in time (a late fragment amending
   * what is already on screen), or a new row.
   */
  private resolveGroup(
    role: "user" | "assistant",
    fragment: Fragment
  ): { group: MutableGroup; created: boolean } {
    const last = this.groups[this.groups.length - 1];
    if (last && last.role === role && !last.sealed) return { group: last, created: false };
    for (let i = this.groups.length - 1; i >= 0; i -= 1) {
      const group = this.groups[i];
      if (group.role !== role || group.fragments.length === 0) continue;
      const end = group.fragments[group.fragments.length - 1].endMs;
      if (fragment.startMs < end) return { group, created: false };
      break;
    }
    // A speaker change ends the other speaker's row: neither can absorb the
    // other's later fragments.
    if (last && last.role !== role) last.sealed = true;
    const group: MutableGroup = {
      groupId: `voice-group-${(this.nextGroupIndex += 1)}`,
      role,
      fragments: [],
      sealed: false,
    };
    this.groups.push(group);
    return { group, created: true };
  }
}

/** Keep a row's fragments in audio order so a late one lands where it was said. */
function insertInAudioOrder(group: MutableGroup, fragment: Fragment): void {
  let index = group.fragments.length;
  while (index > 0 && group.fragments[index - 1].startMs > fragment.startMs) index -= 1;
  group.fragments.splice(index, 0, fragment);
}

/**
 * Join a row's fragments verbatim. Deltas are not sentences and carry their own
 * spacing, so only the caption's outer whitespace is trimmed.
 */
function assembleText(fragments: readonly Fragment[]): string {
  return fragments
    .map((fragment) => fragment.delta)
    .join("")
    .trim();
}

function snapshot(group: MutableGroup): VoiceTranscriptGroup {
  return {
    groupId: group.groupId,
    role: group.role,
    text: assembleText(group.fragments),
    ranges: group.fragments.map((fragment) => ({
      fragmentId: fragment.fragmentId,
      startMs: fragment.startMs,
      endMs: fragment.endMs,
    })),
  };
}
