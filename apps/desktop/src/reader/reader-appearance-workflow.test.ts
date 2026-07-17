import { describe, expect, it, vi } from "vitest";
import { createDomainEventDispatcher, type AnyDomainEvent } from "@sonelle/domain";
import { createReaderPreferences } from "@sonelle/reader";
import { createReaderAppearanceWorkflow } from "./reader-appearance-workflow";

describe("reader appearance workflow", () => {
  it("projects and persists highlight colors through independent event reactions", async () => {
    const eventDispatcher = createDomainEventDispatcher();
    const events: AnyDomainEvent[] = [];
    eventDispatcher.subscribe("ReaderAppearanceChanged", (event) => {
      events.push(event);
    });
    let preferences = createReaderPreferences();
    const save = vi.fn();
    const workflow = createReaderAppearanceWorkflow(
      {
        eventDispatcher,
        repository: { save },
        reportEventError: vi.fn()
      },
      {
        currentPreferences: () => preferences,
        projectAppearance(appearance) {
          preferences = createReaderPreferences({ ...preferences, ...appearance });
        }
      }
    );
    const stop = workflow.start();

    workflow.change({ narrationHighlightColor: "#cceeff" });
    workflow.change({ bookmarkHighlightColor: "#8844aa" });

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(preferences).toMatchObject({
      narrationHighlightColor: "#cceeff",
      bookmarkHighlightColor: "#8844aa"
    });
    expect(events.map((event) => event.name)).toEqual([
      "ReaderAppearanceChanged",
      "ReaderAppearanceChanged"
    ]);

    stop();
  });
});
