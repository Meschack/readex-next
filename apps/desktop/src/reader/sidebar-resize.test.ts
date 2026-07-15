import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  getSidebarResizeBounds,
  resolveSidebarResize,
  sidebarDefaultWidths
} from "./sidebar-resize";

describe("sidebar resizing", () => {
  it("starts both desktop rails wide enough for their content", () => {
    expect(sidebarDefaultWidths).toEqual({ library: 340, inspector: 400 });
  });

  it("keeps the reader column usable while a rail expands", () => {
    expect(
      getSidebarResizeBounds({
        sidebar: "library",
        viewportWidth: 1_200,
        oppositeSidebarWidth: 320
      })
    ).toEqual({ min: 220, max: 320 });
  });

  it("resizes each rail from its own edge", () => {
    const bounds = { min: 220, max: 440 };

    expect(resolveSidebarResize(260, 64, "right", bounds)).toBe(324);
    expect(resolveSidebarResize(320, -64, "left", bounds)).toBe(384);
  });

  it("clamps a rail to its available range", () => {
    expect(clampSidebarWidth(120, { min: 220, max: 400 })).toBe(220);
    expect(clampSidebarWidth(460, { min: 220, max: 400 })).toBe(400);
  });
});
// @vitest-environment happy-dom
