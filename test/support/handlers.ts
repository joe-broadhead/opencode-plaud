/** Drives the plugin's handlers without a host: the fixture recorder and the unit tests build on this. */
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodCall, MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor, owners, type HandlerRuntime } from "../../src/handlers/index.js"
import { manifest, packageName, version } from "../../src/manifest.js"
import { createFakeProvider, type FakeProvider } from "../fixtures/plaud-provider.js"

/** The fixture's clock: after every fake recording has settled. */
export const NOW = Date.parse("2026-11-20T00:00:00.000Z")

export interface RuntimeParts {
  readonly provider?: FakeProvider
  readonly now?: number
  readonly exportRoots?: readonly string[]
  readonly location?: HandlerRuntime["location"]
  readonly accountSignal?: HandlerRuntime["accountSignal"]
  readonly agentRules?: HandlerRuntime["agentRules"]
  readonly sessionRules?: HandlerRuntime["sessionRules"]
}

/** A runtime over the synthetic two-account provider. */
export function runtimeFor(parts: RuntimeParts = {}): HandlerRuntime {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  const root = parts.exportRoots?.[0] ?? "/tmp/plaud-export"
  return {
    packageName,
    manifest,
    version,
    hostVersion: "2.4.1",
    accounts: plan.value.accounts,
    accountProblems: [],
    accountSignal: parts.accountSignal ?? (async () => ({ state: "ready" })),
    provider: parts.provider ?? createFakeProvider(),
    clock: () => parts.now ?? NOW,
    settings: { exportRoots: parts.exportRoots ?? [root], maxAudioBytes: 2 * 1024 ** 3, exportTimeoutMs: 30 * 60_000 },
    location: parts.location ?? { directory: root, project: { directory: root } },
    agentRules: parts.agentRules ?? (async () => []),
    sessionRules: parts.sessionRules ?? (async () => []),
    owners: owners(),
  }
}

/** One handler call, with the call fields `register` would fill. */
export function callFor(account: string, plan?: unknown): MethodCall {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => undefined,
    account,
    ...(plan === undefined ? {} : { plan }),
    bus: { emit: async () => ({ ok: true }) },
    unguardedAgents: async () => ({ ok: true, agents: [] }),
    door: "rpc",
  } as unknown as MethodCall
}

/** Run one method's handler as the door would, with the account already resolved. */
export function run(runtime: HandlerRuntime, method: string, input: Record<string, unknown>, account = "work", plan?: unknown): Promise<unknown> {
  const handler = handlersFor(runtime)[method] as MethodHandler | undefined
  if (handler === undefined) throw new Error(`no handler for ${method}`)
  return handler.run(input, callFor(account, plan))
}

/** The refusal message a handler answers, or a failure when it answered instead. */
export async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error("expected a refusal, and the handler answered")
}
