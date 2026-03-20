import { describe, expect, it } from "vitest";
import { safeUrl } from "./utils";

describe("safeUrl", () => {
  it("accepts a valid absolute URL", () => {
    expect(safeUrl("https://example.com/cover.jpg")).toBe("https://example.com/cover.jpg");
  });
});
