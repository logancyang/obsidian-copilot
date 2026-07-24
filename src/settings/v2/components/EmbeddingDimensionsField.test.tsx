import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { EmbeddingDimensionsField } from "./EmbeddingDimensionsField";

describe("EmbeddingDimensionsField", () => {
  it("publishes a valid positive integer", () => {
    const onChange = jest.fn();

    render(<EmbeddingDimensionsField onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Embedding dimensions"), {
      target: { value: "512" },
    });

    expect(onChange).toHaveBeenCalledWith(512);
  });

  it("publishes undefined when cleared", () => {
    const onChange = jest.fn();

    render(<EmbeddingDimensionsField dimensions={512} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Embedding dimensions"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("keeps a decimal input invalid without publishing it", () => {
    const onChange = jest.fn();
    const onValidityChange = jest.fn();

    render(<EmbeddingDimensionsField onChange={onChange} onValidityChange={onValidityChange} />);

    fireEvent.change(screen.getByLabelText("Embedding dimensions"), {
      target: { value: "1.5" },
    });

    expect(screen.getByText("Embedding dimensions must be a positive integer")).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("shows the existing dimensions", () => {
    render(<EmbeddingDimensionsField dimensions={512} onChange={jest.fn()} />);

    expect(screen.getByLabelText("Embedding dimensions")).toHaveProperty("value", "512");
  });
});
