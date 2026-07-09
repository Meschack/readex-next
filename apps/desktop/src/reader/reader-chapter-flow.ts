import type { ReaderChapterNavigationItem } from "./reader-view";

export function nextReaderChapter(
  chapters: ReaderChapterNavigationItem[],
  activeChapterId: string
): ReaderChapterNavigationItem | null {
  const orderedChapters = [...chapters].sort((first, second) => first.index - second.index);
  const activeIndex = orderedChapters.findIndex((chapter) => chapter.id === activeChapterId);
  if (activeIndex < 0) return null;

  return orderedChapters[activeIndex + 1] ?? null;
}
