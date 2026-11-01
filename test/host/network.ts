/** Fetch boundary, not an OS firewall. Only explicitly registered fixtures may receive requests. */
export function installNetworkGuard() {
  const original = globalThis.fetch
  const origins = new Set<string>()
  const denied: string[] = []
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !origins.has(url.origin)) {
      denied.push(url.origin)
      return Promise.reject(new Error("HOST_FIXTURE_NETWORK_DENIED"))
    }
    // Override Request.redirect as well as RequestInit: no unchecked second hop.
    return original(input, { ...options, redirect: "error" })
  }
  return {
    /** Origins refused so far, in order. */
    get denied(): readonly string[] {
      return denied
    },
    allow(url: string) {
      const origin = new URL(url)
      if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") throw new Error("fixture must use IPv4 loopback")
      origins.add(origin.origin)
      return () => {
        origins.delete(origin.origin)
      }
    },
    restore() {
      globalThis.fetch = original
    },
  }
}
