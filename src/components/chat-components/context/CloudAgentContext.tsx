import React, { createContext, useContext, useMemo } from "react";

/**
 * Context exposing which agent backend ids are cloud agents (not self-hostable).
 * Lives in `chat-components` so the generic composer never imports Agent Mode
 * internals — Agent Mode fills the set from its registry and passes it down.
 *
 * Consumed by {@link AgentPillNode}'s decorator to render a Self-Host cloud
 * warning on the pill. The set is the *immutable* "is this a cloud agent" fact
 * (registry-derived); the *reactive* "is Self-Host Mode on" half is read
 * separately from live settings, so a pill inserted before the toggle still
 * lights up after it. Empty by default, so a pill outside any provider (or in
 * generic chat) simply never warns.
 */
/** Canonical frozen empty set — the single stable reference every consumer uses
 *  as its default, so a fresh `new Set()` never breaks referential stability. */
export const EMPTY_CLOUD_AGENT_IDS: ReadonlySet<string> = Object.freeze(new Set<string>());

const CloudAgentContext = createContext<ReadonlySet<string>>(EMPTY_CLOUD_AGENT_IDS);

/** The set of cloud (non-self-hostable) agent backend ids, or an empty set. */
export function useCloudAgentIds(): ReadonlySet<string> {
  return useContext(CloudAgentContext);
}

interface CloudAgentProviderProps {
  cloudAgentIds: ReadonlySet<string>;
  children: React.ReactNode;
}

/** Makes the cloud-agent id set available to Lexical pill decorators below. */
export function CloudAgentProvider({ cloudAgentIds, children }: CloudAgentProviderProps) {
  // Stabilize on the set reference so consumers don't re-render on every parent
  // render; Agent Mode memoizes the set upstream.
  const value = useMemo(() => cloudAgentIds, [cloudAgentIds]);
  return <CloudAgentContext.Provider value={value}>{children}</CloudAgentContext.Provider>;
}
