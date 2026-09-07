import {
  AgentDefaultEffortSetting,
  type AgentDefaultEffortSettingProps,
} from "@/agentMode/ui/AgentDefaultEffortSetting";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

function renderSetting(props?: Partial<AgentDefaultEffortSettingProps>) {
  const onChange = props?.onChange ?? jest.fn();
  render(
    <AgentDefaultEffortSetting
      value={props?.value ?? null}
      options={props?.options ?? []}
      disabledLabel={props?.disabledLabel ?? "Not supported"}
      onChange={onChange}
    />
  );
  return { onChange };
}

describe("AgentDefaultEffortSetting", () => {
  it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 shows a disabled placeholder until an explicit effort is selected", () => {
    const { onChange } = renderSetting({ options: [{ value: "high", label: "High" }] });
    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(select.value).toBe("");
    expect(select.options[0].disabled).toBe(true);
    expect(screen.getByText("Choose an effort to save this model.")).not.toBeNull();
    fireEvent.change(select, { target: { value: "high" } });
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("renders an unsupported effort state as a disabled select", () => {
    renderSetting();

    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("");
    expect(screen.getByDisplayValue("Not supported")).toBe(select);
  });

  it("renders supported options and reports concrete and agent-default changes", () => {
    const { onChange } = renderSetting({
      options: [
        { value: null, label: "Agent default" },
        { value: "high", label: "High" },
      ],
    });

    const select = screen.getByRole<HTMLSelectElement>("combobox");
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "high" } });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenNthCalledWith(1, "high");
    expect(onChange).toHaveBeenNthCalledWith(2, null);
  });
});
