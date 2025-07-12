import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { PromptSortStrategy } from "@/types";
import React from "react";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-4">
      {/* Privacy Settings Section */}
      <section>
        <SettingItem
          type="textarea"
          title="User System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
          value={settings.userSystemPrompt}
          onChange={(value) => updateSetting("userSystemPrompt", value)}
          placeholder="Enter your system prompt here..."
        />

        <SettingItem
          type="textarea"
          title="Custom Prompt Enhancement Instruction"
          description="Custom instruction template for prompt optimization. Supports placeholders: {prompt}/{original_prompt} or {{prompt}}/{{original_prompt}} (original prompt), {history}/{chat_history} or {{history}}/{{chat_history}} (conversation history), {context}/{added_context} or {{context}}/{{added_context}} (additional context)."
          value={settings.promptEnhancementTemplate}
          onChange={(value) => updateSetting("promptEnhancementTemplate", value)}
          placeholder="You are PromptEngineer, an expert AI assistant specialized in optimizing prompts to be more effective, specific, and actionable.

TASK:
Transform the user's original prompt into an enhanced version that is clearer, more specific, and better structured for optimal AI understanding and response quality.

CONTEXT:
Conversation History:
{{history}}

Additional Context:
{{context}}

Original Prompt:
{{prompt}}

INSTRUCTIONS:
1. Analyze the original prompt, conversation history, and provided context
2. Identify key objectives, requirements, and implied expectations
3. Incorporate relevant context from the conversation history
4. Structure the enhanced prompt with clear instructions and parameters
5. Make the prompt more specific, detailed, and action-oriented
6. Use precise technical language appropriate to the subject matter
7. Output ONLY the enhanced prompt text with no explanations, prefixes, or placeholders

OUTPUT ONLY THE ENHANCED PROMPT WITHOUT ANY EXPLANATION, PREFIX OR SUFFIX."
        />

        <div className="tw-space-y-4">
          <SettingItem
            type="switch"
            title="Custom Prompt Templating"
            description="Enable templating to process variables like {activenote}, {foldername} or {#tag} in prompts. Disable to use raw prompts without any processing."
            checked={settings.enableCustomPromptTemplating}
            onCheckedChange={(checked) => {
              updateSetting("enableCustomPromptTemplating", checked);
            }}
          />

          <SettingItem
            type="select"
            title="Custom Prompts Sort Strategy"
            description="Choose how to sort custom prompts (by recent usage or alphabetically)"
            value={settings.promptSortStrategy}
            onChange={(value) => updateSetting("promptSortStrategy", value)}
            options={[
              { label: "Recency", value: PromptSortStrategy.TIMESTAMP },
              { label: "Alphabetical", value: PromptSortStrategy.ALPHABETICAL },
            ]}
          />

          <SettingItem
            type="switch"
            title="Enable Encryption"
            description="Enable encryption for the API keys."
            checked={settings.enableEncryption}
            onCheckedChange={(checked) => {
              updateSetting("enableEncryption", checked);
            }}
          />

          <SettingItem
            type="switch"
            title="Debug Mode"
            description="Debug mode will log some debug message to the console."
            checked={settings.debug}
            onCheckedChange={(checked) => {
              updateSetting("debug", checked);
            }}
          />
        </div>
      </section>
    </div>
  );
};
