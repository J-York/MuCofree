import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ShareReactionBar from "./ShareReactionBar";
import { createEmptyReactionCounts } from "../share-reactions";

describe("ShareReactionBar", () => {
  it("renders counts, highlights selected key, and calls onSelect when another key is clicked", () => {
    const onSelect = vi.fn();
    const reactionCounts = {
      ...createEmptyReactionCounts(),
      slacking: 3,
      boost: 7,
      healing: 2,
      after_work: 1,
      loop: 5,
    };

    render(
      <ShareReactionBar
        reactionCounts={reactionCounts}
        viewerReactionKey="boost"
        onSelect={onSelect}
      />,
    );

    const boostButton = screen.getByRole("button", { name: /提神/i });
    const loopButton = screen.getByRole("button", { name: /单曲循环/i });

    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(boostButton).toHaveClass("share-reaction-chip", "is-selected");

    fireEvent.click(loopButton);

    expect(onSelect).toHaveBeenCalledWith("loop");
  });

  it("disables all chips when disabled or pending and keeps selected state visible", () => {
    const reactionCounts = {
      ...createEmptyReactionCounts(),
      healing: 4,
    };

    const { rerender } = render(
      <ShareReactionBar
        reactionCounts={reactionCounts}
        viewerReactionKey="healing"
        disabled
        onSelect={() => {}}
      />,
    );

    const healingButton = screen.getByRole("button", { name: /治愈/i });
    const buttonsWhenDisabled = screen.getAllByRole("button");

    expect(healingButton).toHaveClass("share-reaction-chip", "is-selected");
    buttonsWhenDisabled.forEach((button) => {
      expect(button).toBeDisabled();
    });

    rerender(
      <ShareReactionBar
        reactionCounts={reactionCounts}
        viewerReactionKey="healing"
        pending
        onSelect={() => {}}
      />,
    );

    const bar = screen.getByTestId("share-reaction-bar");
    const buttonsWhenPending = screen.getAllByRole("button");

    expect(bar).toHaveAttribute("aria-busy", "true");
    buttonsWhenPending.forEach((button) => {
      expect(button).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /治愈/i })).toHaveClass(
      "share-reaction-chip",
      "is-selected",
    );
  });
});
