import { SessionsSidebarNewProjectRow } from "@/agentMode/ui/SessionsSidebarNewProjectRow";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

type SessionsSidebarNewProjectRowProps = React.ComponentProps<typeof SessionsSidebarNewProjectRow>;

const meta = {
  title: "Agent Mode/Sessions Sidebar New Project Row",
  component: SessionsSidebarNewProjectRow,
  args: {
    name: "",
    saving: false,
    onNameChange: () => {},
    onSubmit: () => {},
    onCancel: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<SessionsSidebarNewProjectRowProps>;
export default meta;

function EditableRow(args: Partial<SessionsSidebarNewProjectRowProps>) {
  const [name, setName] = useState(args.name ?? "");
  return (
    <SessionsSidebarNewProjectRow {...meta.args} {...args} name={name} onNameChange={setName} />
  );
}

const render = (args: Partial<SessionsSidebarNewProjectRowProps>) => <EditableRow {...args} />;

export const Empty: StoryObj<SessionsSidebarNewProjectRowProps> = { render };

export const Typing: StoryObj<SessionsSidebarNewProjectRowProps> = {
  render,
  args: { name: "Garden plans" },
};

export const Saving: StoryObj<SessionsSidebarNewProjectRowProps> = {
  render,
  args: { name: "Garden plans", saving: true },
};

export const Error: StoryObj<SessionsSidebarNewProjectRowProps> = {
  render,
  args: {
    name: "Garden plans",
    error: 'A project with the name "Garden plans" already exists',
  },
};
