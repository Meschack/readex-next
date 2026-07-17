// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { createReaderPreferences, serializeReaderPreferences } from "@sonelle/reader";
import { createReaderPreferencesRepository } from "./reader-preferences-repository";

describe("reader preferences repository", () => {
  beforeEach(() => localStorage.clear());

  it("migrates corrupted legacy rail widths and persists later user resizing", () => {
    localStorage.setItem(
      "sonelle.reader.preferences.v1",
      serializeReaderPreferences(
        createReaderPreferences({
          toolTab: "settings",
          contentFontFamily: "Literata",
          libraryRailWidth: 220,
          inspectorRailWidth: 280
        })
      )
    );
    const firstSession = createReaderPreferencesRepository();

    expect(firstSession.load()).toEqual(
      expect.objectContaining({
        toolTab: "settings",
        contentFontFamily: "Literata",
        libraryRailWidth: 340,
        inspectorRailWidth: 400
      })
    );

    firstSession.save(
      createReaderPreferences({
        ...firstSession.load(),
        libraryRailWidth: 372,
        inspectorRailWidth: 432,
        narrationHighlightColor: "#aaccee",
        bookmarkHighlightColor: "#016630"
      })
    );
    const reopenedSession = createReaderPreferencesRepository();

    expect(reopenedSession.load()).toEqual(
      expect.objectContaining({
        libraryRailWidth: 372,
        inspectorRailWidth: 432,
        narrationHighlightColor: "#aaccee",
        bookmarkHighlightColor: "#016630"
      })
    );
  });
});
