export interface FixtureBook {
  id: string;
  title: string;
  author: string;
  chapter: {
    id: string;
    title: string;
    body: string;
  };
}

export const fixtureBook: FixtureBook = {
  id: "fixture-book-mara",
  title: "The Listening Margin",
  author: "Sample Library",
  chapter: {
    id: "chapter-1",
    title: "Chapter 1",
    body: [
      "Rain softened the windows while Mara settled into the quiet margin of the page.",
      "She kept one hand near the playback controls and followed each sentence with attentive eyes.",
      "The narrator's cadence moved slowly enough for every idea to land.",
      "When an unfamiliar word appeared, she tapped it, read the note, and returned to the story.",
      "Nothing pulled her away from the chapter; the page simply made room for listening."
    ].join(" ")
  }
};
