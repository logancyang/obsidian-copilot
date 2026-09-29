import React from "react";

const passthrough = (displayName) => {
  const Component = ({ children, ...props }) => React.createElement("div", props, children);
  Component.displayName = displayName;
  return Component;
};

export const PanelGroup = passthrough("PanelGroup");
export const Panel = passthrough("Panel");
export const PanelResizeHandle = passthrough("PanelResizeHandle");
