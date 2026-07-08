export interface FixtureBook {
  id: string;
  title: string;
  author: string;
  chapters: FixtureChapter[];
}

export interface FixtureChapter {
  id: string;
  title: string;
  body: string;
}

export const fixtureBook: FixtureBook = {
  id: "fixture-book-mara",
  title: "The Listening Margin",
  author: "Sample Library",
  chapters: [
    {
      id: "chapter-1",
      title: "Chapter 1",
      body: [
        [
          "Rain softened the windows while Mara settled into the quiet margin of the page.",
          "She kept one hand near the playback controls and followed each sentence with attentive eyes.",
          "The narrator's cadence moved slowly enough for every idea to land."
        ].join(" "),
        [
          "When an unfamiliar word appeared, she tapped it, read the note, and returned to the story.",
          "Nothing pulled her away from the chapter; the page simply made room for listening."
        ].join(" ")
      ].join("\n\n")
    },
    {
      id: "chapter-2",
      title: "Chapter 2",
      body: [
        "The next morning, Mara opened the book where the listening had left a small bright mark.",
        [
          "She moved through the chapter list, chose another passage, and let the room fall into rhythm again.",
          "This time, the words felt less like separate sentences and more like a path through the book."
        ].join(" ")
      ].join("\n\n")
    }
  ]
};
