import ts from "typescript"

/**
 * Reads code, not text: comments, prose and string samples never match.
 * Used by test/architecture.test.ts on the sources and by
 * test/pack-install.test.ts on the installed dist/.
 */

function parse(text: string, filename: string): ts.SourceFile {
  const kind = filename.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, kind)
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
  if (diagnostics.length) throw new Error(`Cannot inspect imports in ${filename}: invalid syntax`)
  return source
}

/** The module specifier a node loads, if it loads one; `#computed-module` when it is not a literal. */
function loaded(node: ts.Node): ts.Node | null | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) return node.moduleSpecifier
  if (ts.isImportTypeNode(node)) return ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) return node.moduleReference.expression
  if (ts.isCallExpression(node)) {
    let target: ts.Expression = node.expression
    while (ts.isParenthesizedExpression(target)) target = target.expression
    const property = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)
        ? target.argumentExpression.text
        : undefined
    if (target.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(target) && target.text === "require") || property === "require") {
      return node.arguments[0] ?? null
    }
  }
  return undefined
}

const specifierText = (node: ts.Node | null) => (node && ts.isStringLiteralLike(node) ? node.text : "#computed-module")

/** Every module a file loads: static, dynamic, type-only, `require` and re-exports. */
export function moduleSpecifiers(text: string, filename = "module.ts"): string[] {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    const target = loaded(node)
    if (target !== undefined) found.push(specifierText(target))
    ts.forEachChild(node, visit)
  }
  visit(parse(text, filename))
  return found
}

/** Modules no file may load. Only @opencode/plugin, sdk, client and theme are public. */
const IMPORT_RULES: readonly [RegExp, string][] = [
  [/(?:^|[\\/])packages[\\/][^\\/]+[\\/]src(?:[\\/]|$)/, "private host source (packages/*/src)"],
  [/^@opencode\/[^/]+\/(?:src|dist)(?:\/|$)/, "a path inside an @opencode package instead of its public exports"],
  [/^@opencode\/ai(?:\/|$)/, "@opencode/ai, which changes incompatibly between patch releases"],
  [/^@opencode\/(?!(?:plugin|sdk|client|theme)(?:\/|$))/, "a private host package"],
  [/^@opencode-ai\//, "the OpenCode V1 plugin API"],
  [/^(?:\/|[A-Za-z]:[\\/]|file:)/, "an absolute, machine-local module path"],
]

/**
 * Modules the shipped code may not load: a path the bundler cannot see, effect, and child_process (the plugin
 * starts no process).
 */
const SHIPPED_IMPORT_RULES: readonly [RegExp, string][] = [
  [/^#computed-module$/, "a computed module path"],
  [/^effect(?:\/|$)/, "effect, which plugins must neither bundle nor depend on"],
  [/^(?:node:)?child_process$/, "child_process: the plugin starts no process"],
]

/** `a.b.c` for a property chain, ignoring optional chaining and non-null assertions. */
function chain(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this"
  if (ts.isPropertyAccessExpression(node)) {
    const head = chain(node.expression)
    return head === undefined ? undefined : `${head}.${node.name.text}`
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return chain(node.expression)
  return undefined
}

const endsWith = (text: string | undefined, suffix: string) => text === suffix || text?.endsWith(`.${suffix}`) === true
const nameOf = (node: ts.Node) => {
  const name = (node as { name?: ts.Node }).name
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined
}
const keyed = (node: ts.Node) => ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertySignature(node)

type Rule = (node: ts.Node) => string | false | undefined

/** Fork-only, deprecated, experimental and retired host APIs, in any file. */
const API_RULES: readonly Rule[] = [
  (node) => ts.isIdentifier(node) && /^supports[A-Z]/.test(node.text) && `${node.text}: support markers belong to the retired host fork`,
  (node) => ts.isPropertyAccessExpression(node) && node.name.text === "text" && endsWith(chain(node.expression), "generate")
    && !endsWith(chain(node.expression), "experimental.generate") && "ctx.generate.text is deprecated",
  (node) => ts.isPropertyAccessExpression(node) && ["policies", "artifact"].includes(node.name.text) && endsWith(chain(node.expression), "experimental")
    && `experimental.${node.name.text} is ${node.name.text === "policies" ? "deprecated" : "experimental"}; do not use it`,
  (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "permission.assert")
    && (node.arguments.length !== 1 || (ts.isObjectLiteralExpression(node.arguments[0]!) && node.arguments[0].properties.some((item) => nameOf(item) === "signal")))
    && "call ctx.permission.assert(input) with the input only: no signal or other options",
  (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "Plugin.define") && node.arguments[0] !== undefined
    && ts.isObjectLiteralExpression(node.arguments[0]) && node.arguments[0].properties.some((item) => nameOf(item) === "image")
    && "Plugin.image is dropped: plugins carry no profile image",
  (node) => ts.isPropertyAccessExpression(node) && node.name.text === "slot" && endsWith(chain(node.expression), "ui")
    && "ui.slot: nothing is always visible; show status in the palette dialog",
]

/** A test that may not run: `it.skip(...)`, `describe.only(...)` and so on, for the given modifiers. */
const notRun = (modifiers: readonly string[]): Rule => (node) =>
  ts.isPropertyAccessExpression(node) && modifiers.includes(node.name.text)
    && /^(?:it|test|describe|suite|bench)(?:\.|$)/.test(chain(node.expression) ?? "")
    && `${chain(node)}: every test runs; delete it or make it pass`

/** Tests that do not run. */
const TEST_RULES: readonly Rule[] = [notRun(["skip", "skipIf", "runIf", "only", "todo"])]

export type Scope = "shipped" | "test" | "tooling"

/**
 * Rules a file may be exempt from, in the scopes they apply to. Only the tools RPC and its unit test, a module and a
 * test shared by several plugins, are exempt (see AGENTS.md):
 * - `evaluate hook`: the RPC's one hook turns an ask on one of its own script calls in flight into a deny, because no
 *   one can answer it, and touches nothing else;
 * - `error tags`: the RPC reads OpenCode's `Tool.Error` and `Session.NotFoundError` tags to tell a refusal from an
 *   upstream failure and a missing session from other failures; its unit test fakes those errors.
 */
export type Exemption = "evaluate hook" | "error tags"

const EXEMPTIBLE: Readonly<Record<Exemption, { readonly scopes: readonly Scope[]; readonly rules: readonly Rule[] }>> = {
  "evaluate hook": {
    scopes: ["shipped", "test", "tooling"],
    rules: [
      (node) => ts.isPropertyAccessExpression(node) && node.name.text === "evaluate" && endsWith(chain(node.expression), "permission")
        && "a permission evaluate hook: insert default rules with ctx.agent.transform instead",
      (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "hook") && node.arguments[0] !== undefined
        && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.includes("evaluate")
        && "a permission evaluate hook: insert default rules with ctx.agent.transform instead",
    ],
  },
  "error tags": {
    scopes: ["shipped", "test", "tooling"],
    rules: [
      (node) => ((ts.isPropertyAccessExpression(node) && node.name.text === "_tag") || (keyed(node) && nameOf(node) === "_tag")
        || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === "_tag"))
        && "_tag: private host error tags are not a public API",
    ],
  },
}


/** Every forbidden use in a file, as `<line>: <problem>`, apart from the exempt rules. */
export function forbiddenUses(text: string, filename: string, scope: Scope, exempt: readonly Exemption[] = []): string[] {
  const source = parse(text, filename)
  const imports = scope === "shipped" ? [...IMPORT_RULES, ...SHIPPED_IMPORT_RULES] : IMPORT_RULES
  const exemptible = (Object.keys(EXEMPTIBLE) as Exemption[])
    .filter((name) => !exempt.includes(name) && EXEMPTIBLE[name].scopes.includes(scope))
    .flatMap((name) => EXEMPTIBLE[name].rules)
  const rules = [...API_RULES, ...exemptible, ...(scope === "test" ? TEST_RULES : [])]
  const found: string[] = []
  const report = (node: ts.Node, message: string) => found.push(`${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${message}`)
  const visit = (node: ts.Node) => {
    const target = loaded(node)
    if (target !== undefined) {
      const specifier = specifierText(target)
      const rule = imports.find(([pattern]) => pattern.test(specifier))
      if (rule) report(target ?? node, `loads ${specifier}: ${rule[1]}`)
    }
    for (const rule of rules) {
      const message = rule(node)
      if (message) report(node, message)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** How many uses of an exemptible rule a file has, so an exemption is counted, never open-ended. */
export function exemptUses(text: string, filename: string, exemption: Exemption): number {
  let count = 0
  const visit = (node: ts.Node) => {
    if (EXEMPTIBLE[exemption].rules.some((rule) => rule(node))) count++
    ts.forEachChild(node, visit)
  }
  visit(parse(text, filename))
  return count
}
