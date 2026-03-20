import { describe, expect, it } from "vitest";
import { createEmptyReactionCounts, reactionKeys, reactionSchema } from "./share-reactions.js";

describe("share reactions domain", () => {
  it("exposes the fixed reaction whitelist", () => {
    expect(reactionKeys).toEqual(["slacking", "boost", "healing", "after_work", "loop"]);
  });

  it("parses a valid reaction key", () => {
    expect(reactionSchema.parse("boost")).toBe("boost");
  });

  it("creates empty reaction counts with all keys set to zero", () => {
    expect(createEmptyReactionCounts()).toEqual({
      slacking: 0,
      boost: 0,
      healing: 0,
      after_work: 0,
      loop: 0,
    });
  });
});
