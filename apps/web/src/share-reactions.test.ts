import { describe, expect, it } from "vitest";
import { applyOptimisticReaction, createEmptyReactionCounts } from "./share-reactions";

describe("applyOptimisticReaction", () => {
  it("adds a new reaction when viewer had none", () => {
    const current = createEmptyReactionCounts();

    const next = applyOptimisticReaction(current, null, "boost");

    expect(next).toEqual({
      reactionCounts: {
        ...createEmptyReactionCounts(),
        boost: 1,
      },
      viewerReactionKey: "boost",
    });
  });

  it("switches counts when viewer changes reactions", () => {
    const current = {
      ...createEmptyReactionCounts(),
      boost: 1,
      loop: 2,
    };

    const next = applyOptimisticReaction(current, "boost", "loop");

    expect(next).toEqual({
      reactionCounts: {
        ...createEmptyReactionCounts(),
        boost: 0,
        loop: 3,
      },
      viewerReactionKey: "loop",
    });
  });

  it("removes the reaction when the same key is clicked twice", () => {
    const current = {
      ...createEmptyReactionCounts(),
      healing: 4,
    };

    const next = applyOptimisticReaction(current, "healing", "healing");

    expect(next).toEqual({
      reactionCounts: {
        ...createEmptyReactionCounts(),
        healing: 3,
      },
      viewerReactionKey: null,
    });
  });
});
