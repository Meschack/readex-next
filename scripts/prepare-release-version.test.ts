import { describe, expect, it } from "vitest";
import { nextReleaseVersion, parseVersion } from "./prepare-release-version.mjs";

describe("prepare release version", () => {
  it("uses the manifest version when no matching release tags exist", () => {
    expect(nextReleaseVersion("0.1.0", [])).toBe("0.1.0");
  });

  it("increments the latest patch release tag", () => {
    expect(nextReleaseVersion("0.1.0", ["v0.1.0", "v0.1.1"])).toBe("0.1.2");
  });

  it("allows a manifest minor bump to reset the patch number", () => {
    expect(nextReleaseVersion("0.2.0", ["v0.1.8"])).toBe("0.2.0");
  });

  it("ignores non-release tags", () => {
    expect(parseVersion("reader-polish")).toBeNull();
    expect(nextReleaseVersion("1.0.0", ["reader-polish", "v0.9.9"])).toBe("1.0.0");
  });
});
