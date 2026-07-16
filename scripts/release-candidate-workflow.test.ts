import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("release candidate workflow", () => {
  it("runs the candidate workflow from the verified dev commit", () => {
    const ci = workflow("ci.yml");
    const candidate = workflow("release-candidate.yml");

    expect(ci).toContain("uses: ./.github/workflows/release-candidate.yml");
    expect(ci).toContain("needs: bundle-linux");
    expect(ci).toContain("github.ref == 'refs/heads/dev'");
    expect(candidate).toContain("workflow_call:");
    expect(candidate).not.toContain("workflow_run:");
    expect(candidate).not.toContain("github.event.workflow_run");
  });
});

function workflow(name: string): string {
  return readFileSync(join(repoRoot, ".github", "workflows", name), "utf8");
}
