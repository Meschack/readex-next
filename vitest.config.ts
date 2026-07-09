import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/src-tauri/target/**"]
  },
  resolve: {
    alias: {
      "@readex/domain": resolve(root, "packages/domain/src/index.ts"),
      "@readex/text": resolve(root, "packages/text/src/index.ts"),
      "@readex/reader": resolve(root, "packages/reader/src/index.ts"),
      "@readex/library": resolve(root, "packages/library/src/index.ts"),
      "@readex/audio": resolve(root, "packages/audio/src/index.ts"),
      "@readex/storage": resolve(root, "packages/storage/src/index.ts"),
      "@readex/learning": resolve(root, "packages/learning/src/index.ts")
    }
  }
});
