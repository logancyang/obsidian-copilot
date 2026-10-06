import React from "react";

const passthrough = (displayName) => {
  const Component = ({ children, ...props }) => React.createElement("div", props, children);
  Component.displayName = displayName;
  return Component;
};

export const Group = passthrough("Group");
export const Panel = passthrough("Panel");
export const Separator = passthrough("Separator");
