import React from "react";
import { CustomModel } from "@/aiParams";
import { FormField } from "@/components/ui/form-field";
import { ParameterControl } from "@/components/ui/parameter-controls";
import { DEFAULT_MODEL_SETTING, ModelCapability, ReasoningEffort } from "@/constants";
import { CopilotSettings } from "@/settings/model";
import {
  getDefaultReasoningEffort,
  getDefaultVerbosity,
  REASONING_EFFORT_OPTIONS,
  VERBOSITY_OPTIONS,
} from "@/utils/modelParamsHelper";

/**
 * 参数范围配置（硬编码，简单明了）
 */
const PARAM_RANGES = {
  temperature: { min: 0, max: 2, step: 0.01, default: DEFAULT_MODEL_SETTING.TEMPERATURE },
  topP: { min: 0, max: 1, step: 0.05, default: 0.9 },
  frequencyPenalty: { min: 0, max: 2, step: 0.05, default: 0 },
  maxTokens: { min: 100, max: 128000, step: 100, default: DEFAULT_MODEL_SETTING.MAX_TOKENS },
};

interface ModelParametersEditorProps {
  model: CustomModel;
  settings: CopilotSettings;
  onChange: (field: keyof CustomModel, value: any) => void;
  onReset?: (field: keyof CustomModel) => void;
  showTokenLimit?: boolean; // 是否显示 Token limit，默认 true
}

/**
 * 共享的模型参数编辑器组件
 * 用于 ChatSettingsPopover 和 ModelEditDialog
 */
export function ModelParametersEditor({
  model,
  settings,
  onChange,
  onReset,
  showTokenLimit = true,
}: ModelParametersEditorProps) {
  // 参数值：model.xxx ?? settings.xxx
  const temperature = model.temperature ?? settings.temperature;
  const maxTokens = model.maxTokens ?? settings.maxTokens;
  const topP = model.topP;
  const frequencyPenalty = model.frequencyPenalty;
  const reasoningEffort = model.reasoningEffort;
  const verbosity = model.verbosity;

  // 判断是否为推理模型
  const isReasoningModel =
    model.name.startsWith("o1") ||
    model.name.startsWith("o3") ||
    model.name.startsWith("o4") ||
    model.name.startsWith("gpt-5");

  // 参数适用性判断
  const showReasoningEffort = isReasoningModel && model.provider === "openai";
  const showVerbosity = model.name.startsWith("gpt-5") && model.provider === "openai";

  return (
    <div className="tw-space-y-4">
      {/* Token limit */}
      {showTokenLimit && (
        <FormField>
          <ParameterControl
            type="slider"
            optional={false}
            label="Token limit"
            value={maxTokens}
            onChange={(value) => onChange("maxTokens", value)}
            max={PARAM_RANGES.maxTokens.max}
            min={PARAM_RANGES.maxTokens.min}
            step={PARAM_RANGES.maxTokens.step}
            defaultValue={PARAM_RANGES.maxTokens.default}
            helpText={
              <>
                <p>
                  The maximum number of <em>output tokens</em> to generate. Default is{" "}
                  {PARAM_RANGES.maxTokens.default}.
                </p>
                <em>
                  This number plus the length of your prompt (input tokens) must be smaller than the
                  context window of the model.
                </em>
              </>
            }
          />
        </FormField>
      )}

      {/* Temperature */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={false}
          label="Temperature"
          value={temperature}
          onChange={(value) => onChange("temperature", value)}
          min={PARAM_RANGES.temperature.min}
          max={PARAM_RANGES.temperature.max}
          step={PARAM_RANGES.temperature.step}
          defaultValue={PARAM_RANGES.temperature.default}
          helpText={`Default is ${PARAM_RANGES.temperature.default}. Higher values will result in more creativeness, but also more mistakes. Set to 0 for no randomness.`}
        />
      </FormField>

      {/* Top-P */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={true}
          label="Top-P"
          value={topP}
          onChange={(value) => onChange("topP", value)}
          disableFn={onReset ? () => onReset("topP") : undefined}
          min={PARAM_RANGES.topP.min}
          max={PARAM_RANGES.topP.max}
          step={PARAM_RANGES.topP.step}
          defaultValue={PARAM_RANGES.topP.default}
          helpText={`Default value is ${PARAM_RANGES.topP.default}, the smaller the value, the less variety in the answers, the easier to understand, the larger the value, the larger the range of the AI's vocabulary, the more diverse`}
        />
      </FormField>

      {/* Frequency Penalty */}
      <FormField>
        <ParameterControl
          type="slider"
          optional={true}
          label="Frequency Penalty"
          value={frequencyPenalty}
          onChange={(value) => onChange("frequencyPenalty", value)}
          disableFn={onReset ? () => onReset("frequencyPenalty") : undefined}
          min={PARAM_RANGES.frequencyPenalty.min}
          max={PARAM_RANGES.frequencyPenalty.max}
          step={PARAM_RANGES.frequencyPenalty.step}
          defaultValue={PARAM_RANGES.frequencyPenalty.default}
          helpText={
            <>
              <p>
                The frequency penalty parameter tells the model not to repeat a word that has
                already been used multiple times in the conversation.
              </p>
              <em>The higher the value, the more the model is penalized for repeating words.</em>
            </>
          }
        />
      </FormField>

      {/* Reasoning Effort - Only for reasoning models */}
      {showReasoningEffort && (
        <FormField>
          <ParameterControl
            type="select"
            optional={true}
            label="Reasoning Effort"
            value={reasoningEffort}
            onChange={(value) => onChange("reasoningEffort", value)}
            disableFn={onReset ? () => onReset("reasoningEffort") : undefined}
            defaultValue={settings.reasoningEffort ?? getDefaultReasoningEffort()}
            options={[
              ...(model.name.startsWith("gpt-5")
                ? [{ value: ReasoningEffort.MINIMAL, label: "Minimal" }]
                : []),
              ...REASONING_EFFORT_OPTIONS.filter((opt) => opt.value !== ReasoningEffort.MINIMAL),
            ]}
            helpText={
              <>
                <p>
                  Controls the amount of reasoning effort the model uses. Higher effort provides
                  more thorough reasoning but takes longer. Note: thinking tokens are not available
                  yet!
                </p>
                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                  <li>Minimal: Fastest responses, minimal reasoning (GPT-5 only)</li>
                  <li>Low: Faster responses, basic reasoning (default)</li>
                  <li>Medium: Balanced performance</li>
                  <li>High: Thorough reasoning, slower responses</li>
                </ul>
              </>
            }
          />
        </FormField>
      )}

      {/* Verbosity - Only for GPT-5 models */}
      {showVerbosity && (
        <FormField>
          <ParameterControl
            type="select"
            optional={true}
            label="Verbosity"
            value={verbosity}
            onChange={(value) => onChange("verbosity", value)}
            disableFn={onReset ? () => onReset("verbosity") : undefined}
            defaultValue={settings.verbosity ?? getDefaultVerbosity()}
            options={VERBOSITY_OPTIONS}
            helpText={
              <>
                <p>Controls the length and detail of the model responses.</p>
                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                  <li>Low: Concise, brief responses</li>
                  <li>Medium: Balanced detail</li>
                  <li>High: Detailed, comprehensive responses</li>
                </ul>
              </>
            }
          />
        </FormField>
      )}

      {/* Reasoning Effort - Only for OpenRouter models */}
      {model.provider === "openrouterai" && (
        <FormField>
          <ParameterControl
            type="select"
            optional={true}
            label="Reasoning Effort"
            value={reasoningEffort}
            onChange={(value) => onChange("reasoningEffort", value)}
            disableFn={onReset ? () => onReset("reasoningEffort") : undefined}
            defaultValue={settings.reasoningEffort ?? getDefaultReasoningEffort()}
            options={REASONING_EFFORT_OPTIONS.filter(
              (opt) => opt.value !== ReasoningEffort.MINIMAL
            )}
            helpText={
              <>
                <p>
                  Controls the amount of reasoning effort the model uses. Higher effort provides
                  more thorough reasoning but takes longer.
                </p>
                <ul className="tw-mt-2 tw-space-y-1 tw-text-xs">
                  <li>Low: Faster responses, basic reasoning (default)</li>
                  <li>Medium: Balanced performance</li>
                  <li>High: Thorough reasoning, slower responses</li>
                </ul>
                {!model.capabilities?.includes(ModelCapability.REASONING) && (
                  <p className="tw-mt-2 tw-text-warning">
                    Enable the &quot;Reasoning&quot; capability above to use this feature.
                  </p>
                )}
              </>
            }
          />
        </FormField>
      )}
    </div>
  );
}
