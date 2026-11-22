import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { cn } from "@/lib/utils";
import React from "react";

interface QuickChatPromptSelectProps {
  prompts: readonly { title: string }[];
  value: string;
  onChange: React.ChangeEventHandler<HTMLSelectElement>;
}

export function QuickChatPromptSelect({ prompts, value, onChange }: QuickChatPromptSelectProps) {
  return (
    <ObsidianNativeSelect
      id="system-prompt"
      value={value}
      onChange={onChange}
      options={[
        { label: "Default (AGENTS.md)", value: "" },
        ...prompts.map((prompt) => ({ label: prompt.title, value: prompt.title })),
      ]}
      containerClassName={cn("tw-flex-1")}
    />
  );
}
