import { defineConfig } from "vitest/config"

/**
 * One project per `npm run check` stage:
 * - lint: source rules and the forbidden-API scan, run before anything is built;
 * - unit: the plugin's modules against narrow fakes, and the TUI render test (needs dist/ and Bun);
 * - host: the plugin in an embedded OpenCode host (Node 24);
 * - pack: the packed tarball, installed alone and loaded by stock OpenCode releases.
 */
export default defineConfig({
  // test/tui.test.ts imports src/tui.tsx; the shipped dist/tui.js is built by scripts/build.mjs.
  oxc: { jsx: { runtime: "automatic", importSource: "@opentui/solid" } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "lint", include: ["test/architecture.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/*.test.ts"],
          exclude: ["test/architecture.test.ts", "test/pack-install.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "host",
          include: ["test/host/**/*.test.ts"],
          setupFiles: ["test/host/setup.ts"],
          fileParallelism: false,
          // Starting a host takes seconds on an idle machine and over a minute on a loaded one.
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: "pack",
          include: ["test/pack-install.test.ts"],
          fileParallelism: false,
          testTimeout: 240_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
})
