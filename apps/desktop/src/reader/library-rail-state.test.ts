import { describe, expect, it } from "vitest";
import { createLibraryRailMode, transitionLibraryRailMode } from "./library-rail-state";

describe("library rail state", () => {
  it("focuses the rail on the open book when the reader opens", () => {
    expect(
      transitionLibraryRailMode({ name: "navigation" }, { type: "reader-opened", bookId: "book-1" })
    ).toEqual({
      name: "book",
      bookId: "book-1"
    });
  });

  it("restores the normal navigation rail when the library opens", () => {
    expect(
      transitionLibraryRailMode(createLibraryRailMode("book-1"), { type: "library-opened" })
    ).toEqual({
      name: "navigation"
    });
  });
});
