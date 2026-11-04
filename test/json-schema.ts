/**
 * Checks a value against the JSON Schema subset the RPC contract uses:
 * `type` (object, array, string, integer, boolean, null, or a list of them), `enum`, `properties`,
 * `required`, `additionalProperties: false` and `items`. Returns each
 * problem as `<path>: <problem>`; an empty list means the value fits.
 */
type Schema = {
  readonly type?: string | readonly string[]
  readonly enum?: readonly unknown[]
  readonly properties?: Readonly<Record<string, Schema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
  readonly items?: Schema
}

export function schemaProblems(schema: Schema, value: unknown, path = "$"): string[] {
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`]
  if (Array.isArray(schema.type)) {
    const fits = schema.type.some((type: string) => schemaProblems({ ...schema, type }, value, path).length === 0)
    return fits ? [] : [`${path}: not one of the types ${schema.type.join(", ")}`]
  }
  switch (schema.type) {
    case "null":
      return value === null ? [] : [`${path}: not null`]
    case "string":
    case "boolean":
      return typeof value === schema.type ? [] : [`${path}: not a ${schema.type}`]
    case "integer":
      return Number.isInteger(value) ? [] : [`${path}: not an integer`]
    case "array":
      if (!Array.isArray(value)) return [`${path}: not an array`]
      return schema.items ? value.flatMap((item, index) => schemaProblems(schema.items!, item, `${path}[${index}]`)) : []
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path}: not an object`]
      const record = value as Record<string, unknown>
      const properties = schema.properties ?? {}
      return [
        ...(schema.required ?? []).filter((key) => !(key in record)).map((key) => `${path}.${key}: missing`),
        ...(schema.additionalProperties === false ? Object.keys(record).filter((key) => !(key in properties)).map((key) => `${path}.${key}: not allowed`) : []),
        ...Object.entries(record).flatMap(([key, item]) => (properties[key] ? schemaProblems(properties[key], item, `${path}.${key}`) : [])),
      ]
    }
    default:
      return []
  }
}
