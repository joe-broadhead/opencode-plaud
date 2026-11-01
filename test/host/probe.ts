import { Plugin } from "@opencode/plugin"

/**
 * A test-only plugin that keeps its context per location, so a test can run
 * a registered tool's executor with a real session context, the way the
 * host does, without a model turn.
 */

export interface Probe {
  readonly plugin: Plugin.Plugin
  context(directory: string): Plugin.Context
}

export function createProbe(): Probe {
  const contexts = new Map<string, Plugin.Context>()
  return {
    plugin: Plugin.define({
      id: "opencode-plaud.test.probe",
      setup(ctx) {
        contexts.set(ctx.location.directory, ctx)
      },
    }),
    context(directory) {
      const ctx = contexts.get(directory)
      if (!ctx) throw new Error(`the probe plugin was not set up for ${directory}`)
      return ctx
    },
  }
}
