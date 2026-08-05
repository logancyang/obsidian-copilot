import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "@/components/ui/password-input";

jest.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    function Input(props, ref) {
      return <input ref={ref} {...props} />;
    }
  ),
}));

jest.mock("lucide-react", () => ({
  Eye: () => <span data-testid="eye" />,
  EyeOff: () => <span data-testid="eye-off" />,
}));

describe("password-input", () => {
  describe("PasswordInput()", () => {
    it("renders and adopts externally updated values verbatim", () => {
      const view = render(<PasswordInput value="initial-value" />);
      let input = view.container.querySelector("input") as HTMLInputElement;

      expect(input.value).toBe("initial-value");

      view.rerender(<PasswordInput value="next-value" />);
      const updatedInput = view.container.querySelector("input") as HTMLInputElement;
      expect(updatedInput).toBe(input);
      input = updatedInput;
      expect(input.value).toBe("next-value");
    });

    it("keeps user edits visible while the parent value is unchanged", () => {
      const onChange = jest.fn();
      const view = render(<PasswordInput value="old" onChange={onChange} />);
      const input = view.container.querySelector("input") as HTMLInputElement;
      input.focus();

      fireEvent.change(input, { target: { value: "sk-new" } });

      expect(onChange).toHaveBeenCalledWith("sk-new");
      expect(input.value).toBe("sk-new");

      view.rerender(<PasswordInput value="old" onChange={onChange} />);
      expect(input.value).toBe("sk-new");

      view.rerender(<PasswordInput value="external-update" onChange={onChange} />);
      const updatedInput = view.container.querySelector("input") as HTMLInputElement;
      expect(updatedInput).toBe(input);
      expect(updatedInput.value).toBe("external-update");
      expect(input.ownerDocument.activeElement).toBe(input);

      view.rerender(<PasswordInput value="old" onChange={onChange} />);
      expect(input.value).toBe("old");
      expect(input.ownerDocument.activeElement).toBe(input);
    });

    it("toggles password visibility unless disabled", () => {
      const view = render(<PasswordInput value="secret" />);
      const input = view.container.querySelector("input") as HTMLInputElement;

      fireEvent.click(screen.getByRole("button", { name: "Show password" }));
      expect(input.type).toBe("text");
      expect(screen.getByRole("button", { name: "Hide password" })).not.toBeNull();

      view.rerender(<PasswordInput value="secret" disabled />);
      fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
      expect(input.type).toBe("text");
    });
  });
});
