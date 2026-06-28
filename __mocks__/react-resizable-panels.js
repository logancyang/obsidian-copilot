// react-resizable-panels ships ESM-only (no CJS dist entry), which Jest can't
// parse. Tests never exercise the resize behavior — they only pull the package
// in transitively via UI modals — so stub the three primitives `resizable.tsx`
// consumes with passthrough components that render their children.
import React from "react";

const passthrough = (displayName) => {
  const Component = ({ children, ...props }) => React.createElement("div", props, children);
  Component.displayName = displayName;
  return Component;
};

export const PanelGroup = passthrough("PanelGroup");
export const Panel = passthrough("Panel");
export const PanelResizeHandle = passthrough("PanelResizeHandle");
