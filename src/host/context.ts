import type { Plugin } from "@opencode/plugin"

/**
 * Host types derived from the public `@opencode/plugin` API. Every module
 * under `src/host/` takes these instead of re-deriving them, so a host API
 * change surfaces in one file.
 */

export type PluginContext = Plugin.Context
export type Registration = Awaited<ReturnType<PluginContext["mcp"]["transform"]>>
export type McpEditor = Parameters<Parameters<PluginContext["mcp"]["transform"]>[0]>[0]
type ToolEditor = Parameters<Parameters<PluginContext["tool"]["transform"]>[0]>[0]
type ToolInfo = Parameters<ToolEditor["add"]>[0]
export type ToolContext = Parameters<ToolInfo["execute"]>[1]
