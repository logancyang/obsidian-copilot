/**
 * Tests for MigrateConfirmModal — verifies that the Migrate button is gated
 * behind the acknowledgement checkbox, that confirm fires the callback, and
 * that cancel does not fire the confirm callback.
 *
 * We exercise the React content component directly so we can assert on
 * checkbox/button state without going through Obsidian's Modal lifecycle.
 */

import React from "react";
import { act, fireEvent, screen } from "@testing-library/react";

// Reason: jsdom doesn't provide Obsidian's `activeDocument` global. Alias it
// to `window.document` so the popout-safe identifier resolves at runtime
// here (lint rule `obsidianmd/prefer-active-doc` enforces this name over
// bare `document`). Scoped to this file rather than jest.setup.js to keep
// the alias out of unrelated suites.
if (typeof (window as { activeDocument?: Document }).activeDocument === "undefined") {
  (window as { activeDocument: Document }).activeDocument = window.document;
}

// Mock obsidian before importing the modal file.
jest.mock("obsidian", () => ({
  App: class App {},
  Modal: class Modal {
    app: unknown;
    contentEl = activeDocument.createElement("div");
    constructor(app: unknown) {
      this.app = app;
    }
    open() {}
    close() {}
  },
}));

jest.mock("lucide-react", () => ({
  Info: () => <span data-testid="info-icon" />,
  ShieldCheck: () => <span data-testid="shield-icon" />,
  Smartphone: () => <span data-testid="phone-icon" />,
}));

import { MigrateConfirmModal } from "./MigrateConfirmModal";

/**
 * Render the modal's content by invoking onOpen on an instance so we
 * exercise the same render path as production code.
 */
function renderModal(onConfirm: jest.Mock, onCancel?: jest.Mock) {
  const app = {} as InstanceType<typeof import("obsidian").App>;
  const modal = new MigrateConfirmModal(app, onConfirm, onCancel);
  // Replace the auto-created contentEl with one inside a DOM container so
  // testing-library queries work on it.
  const container = activeDocument.createElement("div");
  activeDocument.body.appendChild(container);
  // Reason: contentEl is provided by the Obsidian Modal mock; we override it
  // so testing-library can discover the rendered DOM under activeDocument.body.
  (modal as unknown as { contentEl: HTMLElement }).contentEl = container;
  // Reason: React 18's createRoot.render is async — wrap onOpen in act() so
  // the rendered DOM is flushed before testing-library queries run.
  act(() => {
    modal.onOpen();
  });
  return { modal, container };
}

describe("MigrateConfirmModal", () => {
  afterEach(() => {
    activeDocument.body.innerHTML = "";
  });

  it("disables the Migrate button until the acknowledgement checkbox is checked", () => {
    const onConfirm = jest.fn();
    renderModal(onConfirm);

    const migrateButton = screen.getByRole("button", { name: /migrate/i });
    expect((migrateButton as HTMLButtonElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();

    // Clicking the disabled button must not fire the callback.
    fireEvent.click(migrateButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("enables Migrate after the checkbox is checked and fires onConfirm on click", () => {
    const onConfirm = jest.fn();
    renderModal(onConfirm);

    const checkbox = screen.getByRole("checkbox");
    act(() => {
      fireEvent.click(checkbox);
    });

    const migrateButton = screen.getByRole("button", { name: /migrate/i });
    expect((migrateButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(migrateButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel and not onConfirm when the user cancels", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { modal } = renderModal(onConfirm, onCancel);

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    act(() => {
      fireEvent.click(cancelButton);
    });

    // The cancel button calls close(); onClose then invokes onCancel.
    act(() => {
      modal.onClose();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
