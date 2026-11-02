import type React from "react";
import { useState } from "react";

interface KeyboardFocusWithin {
  keyboardFocused: boolean;
  focusWithinProps: Pick<React.HTMLAttributes<HTMLElement>, "onFocus" | "onBlur">;
}

// `focus-within` also matches the focus a mouse click leaves behind, which kept hover-only controls showing after a
// click; only keyboard (`:focus-visible`) focus inside the element should reveal them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/802
export function useKeyboardFocusWithin(): KeyboardFocusWithin {
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  return {
    keyboardFocused,
    focusWithinProps: {
      onFocus: (event) => setKeyboardFocused(event.target.matches(":focus-visible")),
      onBlur: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false);
      },
    },
  };
}
