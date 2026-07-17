import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import solid from "vite-plugin-solid";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "scripts/**/*.test.ts",
      "tools/**/*.test.ts"
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/src-tauri/target/**"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "@sonelle/audio/compatibility": resolve(
        root,
        "packages/audio/src/narration-compatibility-api.ts"
      ),
      "@sonelle/audio/narration": resolve(root, "packages/audio/src/narration-api.ts"),
      "@sonelle/audio/testing": resolve(root, "packages/audio/src/narration-fakes.ts"),
      "@sonelle/domain": resolve(root, "packages/domain/src/index.ts"),
      "@sonelle/text": resolve(root, "packages/text/src/index.ts"),
      "@sonelle/reader": resolve(root, "packages/reader/src/index.ts"),
      "@sonelle/library": resolve(root, "packages/library/src/index.ts"),
      "@sonelle/audio": resolve(root, "packages/audio/src/index.ts"),
      "@sonelle/learning": resolve(root, "packages/learning/src/index.ts")
    }
  }
});
