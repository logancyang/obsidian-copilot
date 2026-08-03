import { setChainType, setModelKey } from "@/aiParams";
import { ChainType } from "@/chainType";
import { CopilotPlusExpiredModal } from "@/components/modals/CopilotPlusExpiredModal";
import {
  ChatModelProviders,
  ChatModels,
  EmbeddingModelProviders,
  EmbeddingModels,
  PLUS_UTM_MEDIUMS,
  PlusUtmMedium,
} from "@/constants";
import { EntitlementFeature, verifyEntitlement } from "@/entitlement";
import { BrevilabsClient } from "@/LLMProviders/brevilabsClient";
import { logError, logInfo } from "@/logger";
import {
  CopilotSettings,
  getSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { App, Notice } from "obsidian";
import React from "react";

export const DEFAULT_COPILOT_PLUS_CHAT_MODEL = ChatModels.COPILOT_PLUS_FLASH;
const DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_CHAT_MODEL + "|" + ChatModelProviders.COPILOT_PLUS;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL = EmbeddingModels.COPILOT_PLUS_SMALL;
export const DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY =
  DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL + "|" + EmbeddingModelProviders.COPILOT_PLUS;

/**
 * How often a running session re-validates its license. Well inside the token's
 * ~14-day `exp` so an online user never reaches the expiry cliff, and far apart
 * enough that a long-lived window costs one request a day.
 */
export const ENTITLEMENT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Runtime gate for self-host mode: the user turned it on AND the server-signed
 * entitlement grants `self_host`. The toggle alone is not enough — it is a user
 * preference persisted in `data.json`, so gating on the verified entitlement is
 * what makes a lapsed plan lose self-host once its token expires. The server
 * owns the plan → capability policy; the client never maps plan names.
 */
export function isSelfHostModeValid(): boolean {
  return getSettings().enableSelfHostMode === true && hasVerifiedFeature("self_host");
}

/** Check if the model key is a Copilot Plus model. */
export function isPlusModel(modelKey: string): boolean {
  const settings = getSettings();
  const configuredModel = settings.configuredModels.find(
    (model) => model.configuredModelId === modelKey
  );
  if (configuredModel) {
    return settings.providers[configuredModel.providerId]?.origin.kind === "copilot-plus";
  }
  return (
    (modelKey.split("|")[1] as EmbeddingModelProviders) === EmbeddingModelProviders.COPILOT_PLUS
  );
}

/**
 * Synchronous check for paid (any valid license, incl. Lite) feature access. Use
 * this for the broad Plus-feature gates (model validation, UI state) that should
 * remain available to every paying user.
 */
export function isPaidEnabled(): boolean {
  return getSettings().isPaidUser === true;
}

/**
 * True once the persisted signed-entitlement expiry has passed. Zero means no
 * token-derived expiry is stored. Because this reads editable state, it only
 * tightens the reactive `useIsPlusUser` render gate — the strict gates take
 * expiry from the signed claims in {@link VerifiedEntitlement}, which an edited
 * `data.json` can't move.
 */
function isEntitlementExpired(settings: CopilotSettings): boolean {
  return settings.entitlementExpiresAt > 0 && Date.now() >= settings.entitlementExpiresAt;
}

/**
 * Proof of what a signed entitlement granted, as read from claims verified in
 * THIS process — written by {@link applyEntitlement} (server response) and
 * {@link verifyCachedEntitlement} (cached token re-checked at startup).
 *
 * Every field comes from the same verified claims, so the whole proof is
 * signature-backed: `data.json` can flip persisted booleans and the expiry, but
 * it cannot forge an ES256 signature, and nothing here is read back from it.
 * Taking the expiry from settings instead would leave the gate half-editable —
 * an edited `entitlementExpiresAt` would hold it open past the token's real
 * `exp` for as long as the session lived.
 *
 * `token` is what settings must still hold for the proof to apply. That is how
 * the paths that drop the token (turnOffPaid and markPaidPendingEntitlement)
 * revoke these capabilities without touching this state: no stored token can
 * match `""` while carrying features.
 */
interface VerifiedEntitlement {
  token: string;
  features: ReadonlySet<EntitlementFeature>;
  /** The claims' plan name, for display only — never gated on. */
  plan: string;
  /** The claims' `exp`, in epoch ms. */
  expiresAt: number;
  /**
   * Whether the signed tier is above free. The server downgrades a lapsed paid
   * key to the free policy rather than refusing it a token, so liveness alone
   * does not mean paid — this is the claim that does.
   */
  paid: boolean;
}

/** Frozen "nothing verified" proof — referential stability for the empty state. */
const NO_VERIFIED_ENTITLEMENT: VerifiedEntitlement = Object.freeze({
  token: "",
  features: Object.freeze(new Set<EntitlementFeature>()),
  plan: "",
  expiresAt: 0,
  paid: false,
});

let verified: VerifiedEntitlement = NO_VERIFIED_ENTITLEMENT;

/**
 * Whether the entitlement verified this session still stands: the proof must
 * belong to the token settings currently hold, and the signed `exp` must not
 * have passed. This is the offline window — signature-backed, so unlike the
 * persisted `isPaidUser` an edited `data.json` cannot widen it.
 */
function hasLiveEntitlement(): boolean {
  return verified.token === getSettings().entitlementToken && Date.now() < verified.expiresAt;
}

/**
 * Whether the entitlement verified this session still grants `feature` — a
 * session running past the signed expiry loses the capability.
 *
 * @param feature - Capability to check for.
 */
function hasVerifiedFeature(feature: EntitlementFeature): boolean {
  return hasLiveEntitlement() && verified.features.has(feature);
}

/**
 * Synchronous check for tier >= Plus (excludes Lite) — the gate for
 * Plus-and-above features such as multi-agent fan-out.
 */
export function isPlusEnabled(): boolean {
  const settings = getSettings();
  // Token-derived Plus carries an expiry. Trust it only when the signed token
  // was cryptographically verified this session (not merely a persisted
  // `isPlusUser` boolean) and the `exp` has not passed — so editing data.json
  // cannot unlock the strict gate, even offline.
  if (settings.entitlementExpiresAt > 0) {
    return hasVerifiedFeature("multi_agent");
  }
  // Preserve an existing tokenless state until an authoritative validation
  // replaces it. Current tokenless successes persist this flag as false.
  return settings.isPlusUser === true;
}

/** Hook for paid status (any valid license, incl. Lite). */
export function useIsPaidUser(): boolean | undefined {
  return useSettingsValue().isPaidUser;
}

/**
 * Hook for tier >= Plus (excludes Lite) — the reactive gate for Plus-and-above
 * features.
 */
export function useIsPlusUser(): boolean | undefined {
  const settings = useSettingsValue();
  if (isEntitlementExpired(settings)) {
    return false;
  }
  return settings.isPlusUser;
}

/**
 * Synchronous entitlement check for the multi-agent fan-out feature. Gated on
 * tier >= Plus (not merely "paid"), so Lite users are excluded.
 */
export function canUseMultiAgent(): boolean {
  return isPlusEnabled();
}

/**
 * Authoritative send-boundary entitlement check for the fan-out feature — the
 * single source of truth the non-React session calls before dispatching, so a UI
 * bypass can't evade the paywall.
 *
 * Fast path: a Plus-tier user (cached `isPlusEnabled()`) is allowed with no
 * network call. Slow path: re-verify against `/license` so a stale-false cache
 * still gets through; we then re-read the freshly-applied entitlement (never the
 * broad `isValid`) so Lite stays blocked. Anything not confirmed >= Plus is a
 * HARD block (no single-agent fallback).
 */
export async function ensureMultiAgentEntitlement(
  app?: App,
  context?: Record<string, unknown>
): Promise<boolean> {
  if (isPlusEnabled()) {
    return true;
  }
  // Re-verify so a stale-false cache for a real Plus user still gets through;
  // `validateLicenseKey` applies the signed entitlement or paid-pending state.
  await BrevilabsClient.getInstance().validateLicenseKey(app, {
    feature: "multi_agent_per_turn",
    ...context,
  });
  return isPlusEnabled();
}

/**
 * Surface the multi-agent-is-Plus upgrade prompt, reusing the shared Plus CTA
 * (`navigateToPlusPage`) so callers and tests share one copy + action.
 */
export function showMultiAgentUpgradePrompt(): void {
  new Notice(
    "Multi-agent QA (@-mentioning more than one agent in a turn) is a Copilot Plus feature. Opening the upgrade page…",
    8000
  );
  navigateToPlusPage(PLUS_UTM_MEDIUMS.MULTI_AGENT);
}

/**
 * Reactive form of {@link canUseMultiAgent} for React render gates; subscribes to
 * settings so the gate flips live. Mirrors `useIsPlusUser` (not `isPlusEnabled`),
 * so it can differ from the sync form for a self-host user with the toggle on but
 * no license receipt yet. `undefined` (still resolving) reads as not entitled.
 */
export function useCanUseMultiAgent(): boolean {
  return useIsPlusUser() === true;
}

/**
 * Check if the user has a valid paid license (any tier, incl. Lite).
 *
 * An unreachable server means "unknown", not "unentitled". `requestUrl` rejects
 * when offline, and callers read both a rejection and `undefined` as no license
 * — which would cut off the very offline window the signed token exists to
 * provide. So the call still happens (it is what renews the token), but an
 * unknown answer defers to the signed entitlement.
 *
 * That fallback is the token, never the persisted `isPaidUser`: the flag knows
 * nothing about expiry, so a renewal failing past `exp` would keep answering
 * true and let a self-host user's turn proceed with the runtime gate already
 * closed — quietly rerouting their searches to the cloud.
 */
export async function checkIsPaidUser(
  app?: App,
  context?: Record<string, unknown>
): Promise<boolean | undefined> {
  if (!getSettings().plusLicenseKey) {
    turnOffPaid(app);
    return false;
  }
  const brevilabsClient = BrevilabsClient.getInstance();
  const result = await brevilabsClient.validateLicenseKey(app, context).catch((error) => {
    logInfo("License validation unreachable; falling back to the cached entitlement:", error);
    return { isValid: undefined };
  });
  return result.isValid ?? (hasLiveEntitlement() && verified.paid);
}

/**
 * What the license section should report about the stored license key.
 * `none` means there is nothing to say — no key, or the first check has not
 * answered yet. Everything a stored key can be other than working is `inactive`:
 * lapsed, revoked, mistyped, or past the offline window all leave the user in
 * the same place, with the same thing to do about it.
 */
export type LicenseStatus = "none" | "active" | "inactive";

/** Stored license as the settings UI should present it. */
export interface LicenseState {
  status: LicenseStatus;
  /**
   * Plan the entitlement names, lowercased by the server (e.g. `"believer"`).
   * Absent when no token verifies, which is why callers need a generic label.
   */
  plan?: string;
}

const NO_LICENSE: LicenseState = Object.freeze({ status: "none" });
const INACTIVE_LICENSE: LicenseState = Object.freeze({ status: "inactive" });
/** Paid, but with no verifiable token to name the plan (legacy tokenless keys). */
const UNNAMED_ACTIVE_LICENSE: LicenseState = Object.freeze({ status: "active" });

/**
 * The stored license as the settings section should show it, read from the same
 * session-verified proof the runtime gates use. Sharing that state is what keeps
 * the badge from ever disagreeing with what the user can actually do, and it
 * carries the two properties this would otherwise have to rebuild: the proof is
 * tagged with the token settings must still hold, and {@link hasLiveEntitlement}
 * treats the signed `exp` as its liveness bound.
 *
 * The paid tier decides, never the plan name: the server answers `is_valid` for
 * a lapsed key and downgrades its entitlement to the free policy while the name
 * still says what lapsed, so reading the name would call a former subscriber a
 * Plus user.
 */
export function useLicenseState(): LicenseState {
  const settings = useSettingsValue();
  // The fixed states are frozen constants; a named plan is the one result that
  // has to be built, so it is kept until the name itself changes. Keying on the
  // returned value rather than on `settings` is what stops the cache from
  // outliving a proof that changed without one.
  const namedActive = React.useRef<LicenseState | null>(null);
  if (!settings.plusLicenseKey) {
    return NO_LICENSE;
  }
  if (hasLiveEntitlement()) {
    if (!verified.paid) {
      return INACTIVE_LICENSE;
    }
    if (namedActive.current?.plan !== verified.plan) {
      namedActive.current = { status: "active", plan: verified.plan };
    }
    return namedActive.current;
  }
  // Nothing verified this session. The server can confirm a paid license
  // without signing one (an unshipped `kid`, no WebCrypto), so keep those users
  // active but unnamed — unless a stored expiry has already passed, which no
  // later success has replaced.
  return settings.isPaidUser === true && !isEntitlementExpired(settings)
    ? UNNAMED_ACTIVE_LICENSE
    : INACTIVE_LICENSE;
}

/**
 * Whether the entitlement grants self-host, for the Self-Host settings tab —
 * the entitlement half of {@link isSelfHostModeValid}, without the toggle.
 * Re-verifies the persisted token rather than reading the module-level verified
 * set, because that set is populated asynchronously at startup and React needs a
 * value that settles on its own. Verification is offline (WebCrypto against the
 * embedded public key), so this costs no network call. `undefined` means the
 * check is still in flight.
 *
 * Also forces `enableSelfHostMode` off when a token verifies and its plan does
 * NOT grant self-host, so a downgraded plan's stale toggle doesn't keep reading
 * as on. A token that fails to verify is not that signal — it means "unknown"
 * (kid not shipped yet, WebCrypto unavailable, expired just before the online
 * refresh), and clearing on it would destroy a preference no later success
 * restores, silently leaving searches on Brevilabs cloud. Unknown closes the
 * runtime gate via {@link isSelfHostModeValid} and leaves the preference alone.
 */
export function useIsSelfHostEligible(): boolean | undefined {
  const settings = useSettingsValue();
  const [isEligible, setIsEligible] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void verifyEntitlement(settings.entitlementToken, {
      expectedUserId: settings.userId,
    }).then((claims) => {
      if (cancelled) {
        return;
      }
      const eligible = claims?.features.includes("self_host") === true;
      if (claims && !eligible && settings.enableSelfHostMode) {
        updateSetting("enableSelfHostMode", false);
      }
      setIsEligible(eligible);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.entitlementToken, settings.userId, settings.enableSelfHostMode]);

  return isEligible;
}

/**
 * Apply the Copilot Plus settings.
 * Includes clinical fix to ensure indexing is triggered when embedding model changes,
 * as the automatic detection doesn't work reliably in all scenarios.
 */
export function applyPlusSettings(): void {
  const settings = getSettings();
  const plusProviderIds = new Set(
    Object.values(settings.providers)
      .filter((provider) => provider.origin.kind === "copilot-plus")
      .map((provider) => provider.providerId)
  );
  const defaultModelKey =
    settings.configuredModels.find(
      (model) =>
        plusProviderIds.has(model.providerId) &&
        model.info.id === (DEFAULT_COPILOT_PLUS_CHAT_MODEL as string)
    )?.configuredModelId ?? DEFAULT_COPILOT_PLUS_CHAT_MODEL_KEY;
  const embeddingModelKey = DEFAULT_COPILOT_PLUS_EMBEDDING_MODEL_KEY;
  const previousEmbeddingModelKey = settings.embeddingModelKey;

  logInfo("applyPlusSettings: Changing embedding model", {
    from: previousEmbeddingModelKey,
    to: embeddingModelKey,
    changed: previousEmbeddingModelKey !== embeddingModelKey,
  });

  setModelKey(defaultModelKey);
  setChainType(ChainType.COPILOT_PLUS_CHAIN);
  setSettings({
    defaultModelKey,
    embeddingModelKey,
    defaultChainType: ChainType.COPILOT_PLUS_CHAIN,
  });

  // Ensure indexing happens only once when embedding model changes
  if (previousEmbeddingModelKey !== embeddingModelKey) {
    logInfo("applyPlusSettings: Embedding model changed, triggering indexing");
    import("@/search/vectorStoreManager")
      .then(async (module) => {
        await module.default.getInstance().indexVaultToVectorStore();
      })
      .catch((error) => {
        logError("Failed to trigger indexing after Plus settings applied:", error);
        new Notice(
          "Failed to update Copilot index. Please try force reindexing from the command palette."
        );
      });
  } else {
    logInfo("applyPlusSettings: No embedding model change, skipping indexing");
  }
}

export function createPlusPageUrl(medium: PlusUtmMedium): string {
  return `https://www.obsidiancopilot.com?utm_source=obsidian&utm_medium=${medium}`;
}

export function navigateToPlusPage(medium: PlusUtmMedium): void {
  window.open(createPlusPageUrl(medium), "_blank");
}

/**
 * Paid license confirmed by the server, but no entitlement token was supplied
 * or the supplied token could not be verified. Keep broad paid access while
 * withholding strict features until a signed entitlement verifies.
 */
export function markPaidPendingEntitlement(): void {
  setSettings({
    isPaidUser: true,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

/**
 * Clear all entitlement state silently (no modal). Only invoked on an
 * authoritative negative (invalid license / no license key) via turnOffPaid.
 */
function clearEntitlement(): void {
  setSettings({
    isPaidUser: false,
    isPlusUser: false,
    entitlementToken: "",
    entitlementExpiresAt: 0,
  });
}

/**
 * Turn off paid status.
 * IMPORTANT: This is called on every plugin start for users without a license key (see checkIsPaidUser).
 * DO NOT reset model settings here - it will cause free users to lose their model selections on every app restart.
 * Only update the entitlement flags.
 */
export function turnOffPaid(app?: App): void {
  const previousIsPaidUser = getSettings().isPaidUser;
  clearEntitlement();
  // The expiry modal needs `app`; interactive callers (load, settings, chat)
  // pass it. Rare background paths flip the flag without a modal — they surface
  // their own Notice instead.
  if (previousIsPaidUser && app) {
    new CopilotPlusExpiredModal(app).open();
  }
}

/**
 * Verify a signed entitlement token and, when valid, apply its claims to
 * settings: `isPaidUser` = tier is not free, `isPlusUser` = the `multi_agent`
 * capability is granted (tier >= Plus). The full granted feature set is also
 * recorded in-memory, which is what the `self_host` gate reads.
 *
 * Returns true when the token verified and was applied, false when it could NOT
 * be verified (bad signature, expired, unknown `kid`, or — during rollout — an
 * empty public-key set). An unverifiable token is NOT an authoritative "not
 * entitled" signal, so this never clears flags; the caller decides the fallback
 * (e.g. a license the server already confirmed valid stays paid). Only an
 * authoritative negative (invalid license / no key) downgrades, via turnOffPaid.
 */
export async function applyEntitlement(token: string): Promise<boolean> {
  const claims = await verifyEntitlement(token, { expectedUserId: getSettings().userId });
  if (!claims) {
    return false;
  }
  verified = {
    token,
    features: new Set(claims.features),
    plan: claims.plan,
    expiresAt: claims.exp * 1000,
    paid: claims.tier !== "free",
  };
  setSettings({
    entitlementToken: token,
    entitlementExpiresAt: verified.expiresAt,
    isPaidUser: verified.paid,
    isPlusUser: verified.features.has("multi_agent"),
  });
  return true;
}

/**
 * Re-verify the persisted entitlement token at startup so the strict gates work
 * offline WITHOUT trusting persisted booleans. ES256 verification is offline
 * (WebCrypto against the embedded public key), so a genuine token re-proves
 * itself with no network, while an edited data.json (flipped booleans, future
 * expiry, but no valid signature) leaves the in-memory feature set empty and
 * every strict gate closed. The online `/license` re-validation still runs
 * separately and overrides this with the server's fresh token.
 */
export async function verifyCachedEntitlement(): Promise<void> {
  const { entitlementToken, userId } = getSettings();
  const claims = entitlementToken
    ? await verifyEntitlement(entitlementToken, { expectedUserId: userId })
    : null;
  // main.ts starts this alongside the online /license check, so that check may
  // have installed a fresher token while this verification was in flight. Its
  // result is authoritative; writing this pre-await snapshot over it would tag
  // the proof with a token settings no longer hold, locking a legitimately
  // entitled user out for the rest of the session.
  if (getSettings().entitlementToken !== entitlementToken) {
    return;
  }
  // Otherwise re-tag even on failure: a token that stops verifying (kid
  // rotation, tampering) must drop the capabilities an earlier check granted it.
  verified = {
    token: entitlementToken,
    features: new Set(claims?.features),
    plan: claims?.plan ?? "",
    expiresAt: (claims?.exp ?? 0) * 1000,
    paid: claims ? claims.tier !== "free" : false,
  };
}
