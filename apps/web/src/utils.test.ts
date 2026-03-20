import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { safeUrl } from "./utils";

describe("safeUrl", () => {
  it("accepts a valid absolute URL", () => {
    expect(safeUrl("https://example.com/cover.jpg")).toBe("https://example.com/cover.jpg");
  });
});

describe("test setup", () => {
  it("renders a marker element", () => {
    render(createElement("div", null, "cleanup-marker"));
    expect(screen.getByText("cleanup-marker")).toBeInTheDocument();
  });

  it("starts the next test with a clean DOM", () => {
    expect(screen.queryByText("cleanup-marker")).not.toBeInTheDocument();
  });
});
