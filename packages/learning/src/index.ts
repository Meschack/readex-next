export type WordLearningState = "unknown" | "learning" | "known" | "saved";

export interface WordInsight {
  surface: string;
  definition: string | null;
  translation: string | null;
  state: WordLearningState;
}
