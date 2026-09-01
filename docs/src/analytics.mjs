const CANONICAL_HOSTNAME = "docs.obsidiancopilot.com";
const PERSISTENCE_NAME = "obsidian-copilot-docs";
const STORAGE_PROBE_KEY = "__obsidian_copilot_docs_analytics_probe__";

const URL_PROPERTIES = new Set(["$current_url", "$referrer"]);
const PASSTHROUGH_PROPERTIES = new Set([
  "$browser",
  "$device_id",
  "$device_type",
  "$geoip_country_code",
  "$insert_id",
  "$lib",
  "$lib_version",
  "$os",
  "$pageview_id",
  "$prev_pageview_id",
  "$prev_pageview_duration",
  "$process_person_profile",
  "$sent_at",
  "$session_id",
  "$session_start_timestamp",
  "$time",
  "$window_id",
  "distinct_id",
  "token",
]);
const CAMPAIGN_PROPERTY = /^\$?(?:(?:initial|session_entry)_)?utm_(?:source|medium|campaign)$/;
const ALLOWED_EVENTS = new Set(["$pageview", "$pageleave"]);

function sanitizeUrl(value, includePath = true) {
  if (typeof value !== "string" || value.length === 0) return undefined;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = "";
    url.password = "";
    // Referring-domain attribution does not need arbitrary paths that may contain private input.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
    if (!includePath) url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeCampaignValue(value) {
  if (typeof value !== "string") return undefined;
  const sanitized = value.trim();
  // Campaign fields are free text, so a short bound prevents them from becoming a content channel.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
  return sanitized.length > 0 && sanitized.length <= 80 ? sanitized : undefined;
}

function sanitizeProperties(properties) {
  const sanitized = {};

  for (const [key, value] of Object.entries(properties ?? {})) {
    if (URL_PROPERTIES.has(key)) {
      const safeUrl =
        key === "$referrer" && value === "$direct"
          ? "$direct"
          : sanitizeUrl(value, key !== "$referrer");
      if (safeUrl) sanitized[key] = safeUrl;
      continue;
    }

    if (CAMPAIGN_PROPERTY.test(key)) {
      const safeCampaign = sanitizeCampaignValue(value);
      if (safeCampaign) sanitized[key] = safeCampaign;
      continue;
    }

    if (PASSTHROUGH_PROPERTIES.has(key)) sanitized[key] = value;
  }

  sanitized.$host = CANONICAL_HOSTNAME;
  sanitized.$process_person_profile = false;

  const referrer = sanitized.$referrer;
  if (referrer) {
    sanitized.$referring_domain = referrer === "$direct" ? "$direct" : new URL(referrer).hostname;
  }

  const currentUrl = sanitized.$current_url;
  if (currentUrl) sanitized.$pathname = new URL(currentUrl).pathname;

  return sanitized;
}

export function resolveAnalyticsConfig({ hostname, apiKey, apiHost }) {
  // Production-only collection prevents previews from polluting metrics or testing real-user policy.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
  if (hostname !== CANONICAL_HOSTNAME) return null;

  // Analytics is optional so missing Vercel configuration can never break documentation rendering.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
  if (!apiKey?.trim() || !apiHost?.trim()) return null;

  try {
    const host = new URL(apiHost);
    if (host.protocol !== "https:" || host.username || host.password || host.search || host.hash) {
      return null;
    }
    return { apiKey: apiKey.trim(), apiHost: host.toString().replace(/\/$/, "") };
  } catch {
    return null;
  }
}

export function hasUsableStorage(getStorage) {
  // A failed storage probe disables collection instead of falling back to shared cookies or identity.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
  try {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.setItem(STORAGE_PROBE_KEY, "1");
      return storage.getItem(STORAGE_PROBE_KEY) === "1";
    } finally {
      storage.removeItem(STORAGE_PROBE_KEY);
    }
  } catch {
    return false;
  }
}

export function sanitizeAnalyticsEvent(event) {
  // The allowlist is the final privacy boundary if an SDK default or remote setting changes.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
  if (!event || !ALLOWED_EVENTS.has(event.event)) return null;

  return {
    uuid: event.uuid,
    event: event.event,
    properties: sanitizeProperties(event.properties),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
  };
}

export function createPostHogOptions(apiHost, getCanonicalUrl) {
  return {
    api_host: apiHost,
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    // Boolean true keeps the SDK unload handler active when pageviews are captured manually.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
    capture_pageleave: true,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    advanced_disable_feature_flags: true,
    person_profiles: "never",
    persistence: "localStorage",
    persistence_name: PERSISTENCE_NAME,
    cross_subdomain_cookie: false,
    upgrade: false,
    disable_capture_url_hashes: true,
    disable_scroll_properties: true,
    save_referrer: true,
    save_campaign_params: true,
    // The final event boundary replaces SDK-derived request paths with the generated route identity.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
    before_send: (event) => {
      const canonicalUrl = sanitizeUrl(getCanonicalUrl());
      if (!canonicalUrl || new URL(canonicalUrl).host !== CANONICAL_HOSTNAME) return null;
      return sanitizeAnalyticsEvent({
        ...event,
        properties: {
          ...event.properties,
          $current_url: canonicalUrl,
          $pathname: canonicalUrl,
        },
      });
    },
  };
}

export async function startDocsAnalytics({
  loadPostHog,
  hostname,
  apiKey,
  apiHost,
  getStorage,
  getCanonicalUrl,
  addNavigationListener,
}) {
  const config = resolveAnalyticsConfig({ hostname, apiKey, apiHost });
  if (!config || !hasUsableStorage(getStorage)) return false;

  const pendingNavigations = [];
  let dispatchNavigation = (canonicalUrl) => pendingNavigations.push(canonicalUrl);
  let previousNavigation;
  const handleNavigation = () => {
    const canonicalUrl = getCanonicalUrl();
    // Missing route identity cannot satisfy the outgoing-event privacy contract.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
    if (!canonicalUrl || canonicalUrl === previousNavigation) return;
    previousNavigation = canonicalUrl;
    dispatchNavigation(canonicalUrl);
  };
  let removeNavigationListener = () => {};

  try {
    // Subscribe before the chunk load so cold-cache navigation still produces one event per route.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/335
    removeNavigationListener = addNavigationListener(handleNavigation);
    handleNavigation();

    const posthog = await loadPostHog();
    posthog.init(config.apiKey, createPostHogOptions(config.apiHost, getCanonicalUrl));
    dispatchNavigation = (canonicalUrl) =>
      posthog.capture("$pageview", { $current_url: canonicalUrl });
    pendingNavigations.forEach(dispatchNavigation);
    return true;
  } catch {
    removeNavigationListener();
    return false;
  }
}
