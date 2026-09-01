import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPostHogOptions,
  hasUsableStorage,
  resolveAnalyticsConfig,
  sanitizeAnalyticsEvent,
  startDocsAnalytics,
} from "./analytics.mjs";

const ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/335";

describe("analytics", () => {
  describe("resolveAnalyticsConfig()", () => {
    it(`${ISSUE} enables only the canonical production hostname`, () => {
      assert.deepEqual(
        resolveAnalyticsConfig({
          hostname: "docs.obsidiancopilot.com",
          apiKey: " phc_test ",
          apiHost: "https://us.i.posthog.com/",
        }),
        { apiKey: "phc_test", apiHost: "https://us.i.posthog.com" }
      );
      assert.equal(
        resolveAnalyticsConfig({
          hostname: "preview.example.com",
          apiKey: "phc_test",
          apiHost: "https://us.i.posthog.com",
        }),
        null
      );
    });

    it(`${ISSUE} disables analytics when either optional setting is missing`, () => {
      assert.equal(
        resolveAnalyticsConfig({
          hostname: "docs.obsidiancopilot.com",
          apiKey: "",
          apiHost: "https://us.i.posthog.com",
        }),
        null
      );
      assert.equal(
        resolveAnalyticsConfig({
          hostname: "docs.obsidiancopilot.com",
          apiKey: "phc_test",
          apiHost: undefined,
        }),
        null
      );
    });
  });

  describe("hasUsableStorage()", () => {
    it(`${ISSUE} fails closed when browser storage is unavailable`, () => {
      assert.equal(
        hasUsableStorage(() => {
          throw new Error("blocked");
        }),
        false
      );
    });

    it(`${ISSUE} removes its successful storage probe`, () => {
      const values = new Map();
      assert.equal(
        hasUsableStorage(() => ({
          setItem: (key, value) => values.set(key, value),
          getItem: (key) => values.get(key),
          removeItem: (key) => values.delete(key),
        })),
        true
      );
      assert.equal(values.size, 0);
    });

    it(`${ISSUE} fails closed when storage silently drops writes`, () => {
      assert.equal(
        hasUsableStorage(() => ({
          setItem: () => {},
          getItem: () => null,
          removeItem: () => {},
        })),
        false
      );
    });
  });

  describe("createPostHogOptions()", () => {
    it(`${ISSUE} disables automatic collection and identity joining`, () => {
      const options = createPostHogOptions("https://us.i.posthog.com");
      assert.equal(options.autocapture, false);
      assert.equal(options.capture_pageview, false);
      assert.equal(options.capture_pageleave, true);
      assert.equal(options.disable_session_recording, true);
      assert.equal(options.disable_surveys, true);
      assert.equal(options.disable_conversations, true);
      assert.equal(options.disable_product_tours, true);
      assert.equal(options.disable_external_dependency_loading, true);
      assert.equal(options.advanced_disable_flags, true);
      assert.equal(options.advanced_disable_feature_flags, true);
      assert.equal(options.person_profiles, "never");
      assert.equal(options.persistence, "localStorage");
      assert.equal(options.persistence_name, "obsidian-copilot-docs");
      assert.equal(options.cross_subdomain_cookie, false);
      assert.equal(options.before_send, sanitizeAnalyticsEvent);
    });
  });

  describe("sanitizeAnalyticsEvent()", () => {
    it(`${ISSUE} allows only pageview and pageleave events`, () => {
      assert.equal(
        sanitizeAnalyticsEvent({ event: "$autocapture", properties: {}, uuid: "event-id" }),
        null
      );
      assert.equal(
        sanitizeAnalyticsEvent({ event: "docs_search", properties: {}, uuid: "event-id" }),
        null
      );
      assert.equal(
        sanitizeAnalyticsEvent({ event: "$pageleave", properties: {}, uuid: "event-id" }).event,
        "$pageleave"
      );
    });

    it(`${ISSUE} strips private URL, referrer, content, and person properties`, () => {
      const timestamp = new Date("2026-08-31T12:00:00Z");
      const result = sanitizeAnalyticsEvent({
        uuid: "event-id",
        event: "$pageview",
        timestamp,
        properties: {
          $current_url:
            "https://person:secret@docs.obsidiancopilot.com/getting-started/?query=private#answer",
          $pathname: "/wrong?query=private#answer",
          $referrer: "https://user:pass@example.com/article/?secret=yes#section",
          $referring_domain: "untrusted.example",
          $browser: "Chrome",
          $browser_version: "140.0.0.0",
          $device_type: "Desktop",
          $geoip_country_code: "US",
          $screen_height: 1080,
          $screen_width: 1920,
          distinct_id: "anonymous-id",
          $set: { email: "reader@example.com" },
          search: "private search",
          $search_engine: "Google",
          $event_type: "submit",
          $element_text: "private form content",
          email: "reader@example.com",
          gclid: "ad-click-id",
        },
        $set: { email: "reader@example.com" },
        $set_once: { initial_email: "reader@example.com" },
      });

      assert.deepEqual(result, {
        uuid: "event-id",
        event: "$pageview",
        timestamp,
        properties: {
          $current_url: "https://docs.obsidiancopilot.com/getting-started/",
          $referrer: "https://example.com/article/",
          $browser: "Chrome",
          $device_type: "Desktop",
          $geoip_country_code: "US",
          distinct_id: "anonymous-id",
          $host: "docs.obsidiancopilot.com",
          $process_person_profile: false,
          $referring_domain: "example.com",
          $pathname: "/getting-started/",
        },
      });
    });

    it(`${ISSUE} preserves direct traffic and drops malformed or non-URL values`, () => {
      const direct = sanitizeAnalyticsEvent({
        uuid: "event-id",
        event: "$pageview",
        properties: { $current_url: "not a URL", $referrer: "$direct", $pathname: "private" },
      });
      assert.deepEqual(direct.properties, {
        $referrer: "$direct",
        $host: "docs.obsidiancopilot.com",
        $process_person_profile: false,
        $referring_domain: "$direct",
      });

      const malformed = sanitizeAnalyticsEvent({
        uuid: "event-id",
        event: "$pageview",
        properties: { $current_url: "https://[invalid", $referrer: "https://[invalid" },
      });
      assert.deepEqual(malformed.properties, {
        $host: "docs.obsidiancopilot.com",
        $process_person_profile: false,
      });
    });

    it(`${ISSUE} keeps only bounded source, medium, and campaign attribution`, () => {
      const result = sanitizeAnalyticsEvent({
        uuid: "event-id",
        event: "$pageview",
        properties: {
          $utm_source: " newsletter ",
          $initial_utm_medium: "email",
          $session_entry_utm_campaign: "launch",
          utm_term: "private keyword",
          $initial_gclid: "ad-click-id",
          $utm_campaign: "x".repeat(81),
          $session_entry_utm_source: "   ",
        },
      });

      assert.deepEqual(result.properties, {
        $utm_source: "newsletter",
        $initial_utm_medium: "email",
        $session_entry_utm_campaign: "launch",
        $host: "docs.obsidiancopilot.com",
        $process_person_profile: false,
      });
    });
  });

  describe("startDocsAnalytics()", () => {
    it(`${ISSUE} does not initialize when storage cannot be used`, () => {
      let initialized = false;
      const enabled = startDocsAnalytics({
        posthog: { init: () => (initialized = true) },
        hostname: "docs.obsidiancopilot.com",
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
        getStorage: () => null,
        getCurrentUrl: () => "https://docs.obsidiancopilot.com/",
        addNavigationListener: () => {},
      });
      assert.equal(enabled, false);
      assert.equal(initialized, false);
    });

    it(`${ISSUE} captures once per initial load or client-side navigation`, () => {
      const captures = [];
      let navigationListener;
      let currentUrl = "https://docs.obsidiancopilot.com/?private=one";
      const enabled = startDocsAnalytics({
        posthog: {
          init: () => {},
          capture: (event, properties) => captures.push({ event, properties }),
        },
        hostname: "docs.obsidiancopilot.com",
        apiKey: "phc_test",
        apiHost: "https://us.i.posthog.com",
        getStorage: () => ({ setItem: () => {}, getItem: () => "1", removeItem: () => {} }),
        getCurrentUrl: () => currentUrl,
        addNavigationListener: (listener) => (navigationListener = listener),
      });

      navigationListener();
      currentUrl = "https://docs.obsidiancopilot.com/getting-started/?private=two";
      navigationListener();

      assert.equal(enabled, true);
      assert.deepEqual(captures, [
        {
          event: "$pageview",
          properties: { $current_url: "https://docs.obsidiancopilot.com/?private=one" },
        },
        {
          event: "$pageview",
          properties: {
            $current_url: "https://docs.obsidiancopilot.com/getting-started/?private=two",
          },
        },
      ]);
    });
  });
});
