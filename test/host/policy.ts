import { Plugin } from "@opencode/plugin"

/**
 * A test-only policy plugin: it asks the host's `permission.evaluate` hook to deny every `external_directory` call.
 * A plugin's own local file write never reaches that hook, which is the hole `docs/security.md` states.
 */
export const policy = Plugin.define({
  id: "plaud.test.policy",
  async setup(ctx) {
    await ctx.permission.hook("evaluate", (input) => {
      if (input.action === "external_directory") input.effect = "deny"
    })
  },
})
