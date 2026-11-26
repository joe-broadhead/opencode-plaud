import { defineConfig } from "vitest/config"

/**
 * One project per `npm run check` stage:
 * - unit: handlers, provider mapping, settings, the export matcher against the host's, and the recorded fixture;
 * - host: the built plugin in an embedded OpenCode 2.4.1 host, on a loopback fake Plaud;
 * - pack: the packed tarball, installed alone and loaded by stock OpenCode.
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/*.test.ts", "test/unit/**/*.test.ts"], exclude: ["test/pack.test.ts"], testTimeout: 30_000 },
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
        test: { name: "pack", include: ["test/pack.test.ts"], fileParallelism: false, testTimeout: 240_000, hookTimeout: 240_000 },
      },
    ],
  },
})
