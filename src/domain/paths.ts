import { isAbsolute, resolve, sep } from "node:path"

/** True when `path` is `root` itself or below it. Relative paths never match. */
export function underRoot(path: string, root: string): boolean {
  if (!isAbsolute(path) || !isAbsolute(root)) return false
  const child = resolve(path)
  const parent = resolve(root)
  if (child === parent) return true
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
}

export function underAnyRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => underRoot(path, root))
}
