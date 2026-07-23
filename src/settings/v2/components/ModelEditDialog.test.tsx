import type { CustomModel } from "@/aiParams";
import { EmbeddingModelProviders } from "@/constants";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const pluginRoot = {
  render: jest.fn<void, [React.ReactElement]>(),
  unmount: jest.fn(),
};

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));
jest.mock("@/components/ui/checkbox", () => ({ Checkbox: () => null }));
jest.mock("@/components/ui/form-field", () => ({
  FormField: ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
    <div>
      {label}
      {children}
    </div>
  ),
}));
jest.mock("@/components/ui/help-tooltip", () => ({ HelpTooltip: () => null }));
jest.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />
  ),
}));
jest.mock("@/components/ui/label", () => ({ Label: () => null }));
jest.mock("@/components/ui/password-input", () => ({ PasswordInput: () => null }));
jest.mock("@/components/ui/ModelParametersEditor", () => ({ ModelParametersEditor: () => null }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(() => ({})) }));
jest.mock("@/utils", () => ({
  debounce: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  getProviderInfo: jest.fn(() => ({})),
  getProviderLabel: jest.fn((provider: string) => provider),
}));
jest.mock("@/utils/modelUtils", () => ({
  getApiKeyForProvider: jest.fn(() => ""),
}));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(() => pluginRoot),
}));
jest.mock("obsidian", () => ({
  Modal: class {
    contentEl = window.document.createElement("div");
    modalEl = { addClass: jest.fn() };

    constructor(protected app: unknown) {}

    setTitle(): void {}
    close(): void {}
  },
  Platform: { isMobile: false },
}));

import { ModelEditModal } from "./ModelEditDialog";

describe("ModelEditModal embedding dimensions", () => {
  it("sends edited and cleared dimensions through the model update callback", () => {
    const originalModel: CustomModel = {
      name: "nomic-embed-text-v1.5",
      provider: EmbeddingModelProviders.OPENAI_FORMAT,
      enabled: true,
      isEmbeddingModel: true,
      dimensions: 512,
    };
    const onUpdate = jest.fn();
    const modal = new ModelEditModal({} as never, originalModel, true, onUpdate);

    modal.onOpen();
    render(pluginRoot.render.mock.calls[0][0]);

    fireEvent.change(screen.getByLabelText("Embedding dimensions"), {
      target: { value: "1024" },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(
      true,
      originalModel,
      expect.objectContaining({ dimensions: 1024 })
    );

    fireEvent.change(screen.getByLabelText("Embedding dimensions"), {
      target: { value: "" },
    });
    expect(onUpdate).toHaveBeenLastCalledWith(
      true,
      originalModel,
      expect.objectContaining({ dimensions: undefined })
    );
  });
});
