import React, { useCallback, useEffect, useRef } from "react";

/**
 * Configuration for Vim-style navigation in the chat messages area.
 */
export interface VimNavigationConfig {
  enabled: boolean;
  scrollUpKey: string; // 'k'
  scrollDownKey: string; // 'j'
  focusInputKey: string; // 'i'
  scrollSpeed?: number; // px per second, default 960
  focusInput: () => void;
}

/**
 * Default scroll speed in pixels per second.
 * 960px/s provides smooth scrolling across all refresh rates.
 */
const DEFAULT_SCROLL_SPEED_PX_PER_SECOND = 960;

/**
 * Maximum scroll speed in pixels per second to prevent excessive scrolling.
 */
const MAX_SCROLL_SPEED_PX_PER_SECOND = 10_000;

/**
 * Validates and clamps scroll speed to a safe, finite range.
 */
function sanitizeScrollSpeedPxPerSecond(scrollSpeed?: number): number {
  if (typeof scrollSpeed !== "number" || !Number.isFinite(scrollSpeed) || scrollSpeed <= 0) {
    return DEFAULT_SCROLL_SPEED_PX_PER_SECOND;
  }

  return Math.min(scrollSpeed, MAX_SCROLL_SPEED_PX_PER_SECOND);
}

/**
 * Return type for the useVimNavigation hook.
 */
export interface VimNavigationReturn {
  messagesRef: React.MutableRefObject<HTMLDivElement | null>;
  focusMessages: () => void;
  handleMessagesKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  handleMessagesBlur: React.FocusEventHandler<HTMLDivElement>;
}

type ScrollDirection = "up" | "down" | null;

interface NormalizedVimKeys {
  scrollUp: string;
  scrollDown: string;
  focusInput: string;
}

interface StopScrollingOptions {
  clearPressedKeys?: boolean;
}

/**
 * Normalizes a key string for case-insensitive comparisons.
 * Preserves space key for proper matching.
 */
function normalizeKey(key: string): string {
  const rawKey = key ?? "";
  // Preserve space key
  if (rawKey === " ") {
    return " ";
  }

  const normalized = rawKey.trim().toLowerCase();
  // Future: support named keys like "space", "spacebar" when parser is extended
  if (normalized === "space" || normalized === "spacebar") {
    return " ";
  }

  return normalized;
}

/**
 * Normalizes Vim navigation keys for case-insensitive matching.
 * Key uniqueness is validated by the settings parser, so no deduplication here.
 */
function normalizeVimKeys(
  scrollUpKey: string,
  scrollDownKey: string,
  focusInputKey: string
): NormalizedVimKeys {
  return {
    scrollUp: normalizeKey(scrollUpKey),
    scrollDown: normalizeKey(scrollDownKey),
    focusInput: normalizeKey(focusInputKey),
  };
}

/**
 * Checks whether a keyboard event has any modifier keys pressed (Ctrl/Meta/Alt).
 * Note: Shift is intentionally excluded to allow case-insensitive key matching.
 */
function hasModifierKey(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/**
 * Hook implementing Vim-style navigation for the chat messages area:
 * - Hold j/k to continuously scroll (RAF loop)
 * - Press i to focus the input
 * - Global keyup stops scrolling
 */
export function useVimNavigation(config: VimNavigationConfig): VimNavigationReturn {
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const isUnmountedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const lastRafTimestampRef = useRef<number | null>(null);
  const directionRef = useRef<ScrollDirection>(null);
  const pressedScrollKeysRef = useRef<Set<string>>(new Set());

  // Store config values in refs to avoid stale closures
  const enabledRef = useRef<boolean>(config.enabled);
  const keysRef = useRef<NormalizedVimKeys>(
    normalizeVimKeys(config.scrollUpKey, config.scrollDownKey, config.focusInputKey)
  );
  const scrollSpeedRef = useRef<number>(sanitizeScrollSpeedPxPerSecond(config.scrollSpeed));
  const focusInputRef = useRef<() => void>(config.focusInput);

  /**
   * Stops the active scroll loop and optionally clears pressed-key state.
   */
  const stopScrolling = useCallback((options?: StopScrollingOptions) => {
    directionRef.current = null;
    lastRafTimestampRef.current = null;

    if (options?.clearPressedKeys) {
      pressedScrollKeysRef.current.clear();
    }

    if (rafIdRef.current !== null) {
      window.cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const scrollLoopRef = useRef<(timestamp: number) => void>(() => {});

  /**
   * Ensures there is a single RAF scroll loop running (deduped).
   */
  const ensureScrollLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      return;
    }
    rafIdRef.current = window.requestAnimationFrame((timestamp) => scrollLoopRef.current(timestamp));
  }, []);

  // The actual scroll loop implementation with time-based scrolling
  scrollLoopRef.current = (timestamp: number) => {
    rafIdRef.current = null;

    if (isUnmountedRef.current || !enabledRef.current) {
      stopScrolling({ clearPressedKeys: true });
      return;
    }

    const direction = directionRef.current;
    if (!direction) {
      return;
    }

    const container = messagesRef.current;
    if (!container || !container.isConnected) {
      stopScrolling({ clearPressedKeys: true });
      return;
    }

    const lastTimestamp = lastRafTimestampRef.current;
    lastRafTimestampRef.current = timestamp;

    // First frame: use a small default delta to start scrolling immediately
    // This avoids the perceived delay when first pressing the scroll key
    const deltaTimeMs = lastTimestamp === null ? 16 : timestamp - lastTimestamp;

    // Guard against invalid deltaTime (e.g., negative or zero)
    if (deltaTimeMs <= 0) {
      rafIdRef.current = window.requestAnimationFrame((t) => scrollLoopRef.current(t));
      return;
    }

    // Clamp deltaTime to prevent large jumps after long frame stalls (tab switch, GC, etc.)
    const clampedDeltaTimeMs = Math.min(deltaTimeMs, 100);

    // Calculate scroll delta based on time elapsed (px/second)
    const speedPxPerSecond = scrollSpeedRef.current;
    // Guard against invalid speed (should not happen with sanitizeScrollSpeedPxPerSecond, but be safe)
    if (!Number.isFinite(speedPxPerSecond) || speedPxPerSecond <= 0) {
      stopScrolling({ clearPressedKeys: true });
      return;
    }
    const delta = (direction === "up" ? -1 : 1) * speedPxPerSecond * (clampedDeltaTimeMs / 1000);

    const previousScrollTop = container.scrollTop;
    container.scrollTop = previousScrollTop + delta;

    // Check if we've reached the scroll boundary
    if (container.scrollTop === previousScrollTop) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const isAtBoundary =
        (direction === "up" && previousScrollTop <= 0) ||
        (direction === "down" && previousScrollTop >= maxScrollTop);

      if (isAtBoundary) {
        stopScrolling();
        return;
      }
    }

    if (isUnmountedRef.current || !enabledRef.current || !directionRef.current) {
      return;
    }

    rafIdRef.current = window.requestAnimationFrame((t) => scrollLoopRef.current(t));
  };

  /**
   * Focuses the messages container (for Escape-from-input behavior).
   */
  const focusMessages = useCallback(() => {
    const container = messagesRef.current;
    if (!container || !container.isConnected) {
      return;
    }

    try {
      container.focus({ preventScroll: true });
    } catch {
      container.focus();
    }
  }, []);

  /**
   * Keydown handler for the messages container.
   */
  const handleMessagesKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      if (!enabledRef.current) {
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      // Check isComposing on the native event (IME input)
      if (event.nativeEvent.isComposing) {
        return;
      }

      if (hasModifierKey(event)) {
        return;
      }

      // Only handle events when the container itself has focus (not child elements)
      if (event.target !== event.currentTarget) {
        return;
      }

      const { scrollUp, scrollDown, focusInput } = keysRef.current;
      const key = normalizeKey(event.key);

      if (key === focusInput) {
        event.preventDefault();
        event.stopPropagation();
        stopScrolling({ clearPressedKeys: true });
        focusInputRef.current();
        return;
      }

      if (key === scrollUp || key === scrollDown) {
        event.preventDefault();
        event.stopPropagation();

        pressedScrollKeysRef.current.add(key);
        directionRef.current = key === scrollUp ? "up" : "down";

        ensureScrollLoop();
      }
    },
    [ensureScrollLoop, stopScrolling]
  );

  /**
   * Blur handler for the messages container.
   * Stops scrolling when focus leaves the container (e.g., mouse click elsewhere).
   */
  const handleMessagesBlur: React.FocusEventHandler<HTMLDivElement> = useCallback(() => {
    stopScrolling({ clearPressedKeys: true });
  }, [stopScrolling]);

  // Cleanup on unmount
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      stopScrolling({ clearPressedKeys: true });
    };
  }, [stopScrolling]);

  // Update refs when config changes
  useEffect(() => {
    // Detect if scroll keys changed - if so, stop scrolling to avoid keyup mismatch
    const previousKeys = keysRef.current;
    const nextKeys = normalizeVimKeys(
      config.scrollUpKey,
      config.scrollDownKey,
      config.focusInputKey
    );
    const scrollKeysChanged =
      previousKeys.scrollUp !== nextKeys.scrollUp || previousKeys.scrollDown !== nextKeys.scrollDown;

    enabledRef.current = config.enabled;
    keysRef.current = nextKeys;
    scrollSpeedRef.current = sanitizeScrollSpeedPxPerSecond(config.scrollSpeed);
    focusInputRef.current = config.focusInput;

    // Stop scrolling if disabled or if scroll keys changed (prevents keyup mismatch)
    if (!config.enabled || scrollKeysChanged) {
      stopScrolling({ clearPressedKeys: true });
    }
  }, [
    config.enabled,
    config.scrollUpKey,
    config.scrollDownKey,
    config.focusInputKey,
    config.scrollSpeed,
    config.focusInput,
    stopScrolling,
  ]);

  // Global keyup listener to stop scrolling when key is released
  useEffect(() => {
    if (!config.enabled) {
      return;
    }

    if (typeof document === "undefined") {
      return;
    }

    /**
     * Global keyup handler that stops the RAF scroll loop when the scroll key is released.
     */
    const handleKeyUp = (event: KeyboardEvent) => {
      // Fast path: skip processing if no scroll keys are currently pressed
      // This avoids unnecessary key normalization when user is typing elsewhere
      if (pressedScrollKeysRef.current.size === 0) {
        return;
      }

      const { scrollUp, scrollDown } = keysRef.current;
      const releasedKey = normalizeKey(event.key);

      if (releasedKey !== scrollUp && releasedKey !== scrollDown) {
        return;
      }

      pressedScrollKeysRef.current.delete(releasedKey);

      // If another scroll key is still pressed, continue in that direction
      if (pressedScrollKeysRef.current.has(scrollUp)) {
        directionRef.current = "up";
        ensureScrollLoop();
        return;
      }

      if (pressedScrollKeysRef.current.has(scrollDown)) {
        directionRef.current = "down";
        ensureScrollLoop();
        return;
      }

      stopScrolling({ clearPressedKeys: true });
    };

    // Use capture phase to ensure we receive keyup even if other handlers stop propagation
    document.addEventListener("keyup", handleKeyUp, true);

    return () => {
      document.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [config.enabled, ensureScrollLoop, stopScrolling]);

  // Stop scrolling if the app/window loses focus or becomes hidden
  useEffect(() => {
    if (!config.enabled) {
      return;
    }

    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    /**
     * Stops scrolling when the window loses focus.
     */
    const handleWindowBlur = () => {
      stopScrolling({ clearPressedKeys: true });
    };

    /**
     * Stops scrolling when the document becomes hidden (e.g., app minimized or switched away).
     */
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        stopScrolling({ clearPressedKeys: true });
      }
    };

    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [config.enabled, stopScrolling]);

  return {
    messagesRef,
    focusMessages,
    handleMessagesKeyDown,
    handleMessagesBlur,
  };
}
