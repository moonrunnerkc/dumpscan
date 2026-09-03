/**
 * The JSON data model dumpscan canonicalizes. Deliberately narrower than
 * `unknown`: `undefined`, functions, `Map`, `Set`, and `Date` are not JSON and
 * silently dropping them would change a digest without changing the source.
 */
export type JsonPrimitive = string | number | boolean | null;

export type JsonArray = readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Parses JSON text into the canonicalizable data model.
 *
 * @param text - JSON text.
 * @returns The parsed value.
 * @throws SyntaxError when the text is not valid JSON.
 */
export function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}

/**
 * Narrows a value to a JSON object.
 *
 * @param value - Any JSON value.
 * @returns True when the value is a non-null, non-array object.
 */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Narrows a value to a JSON array.
 *
 * @param value - Any JSON value.
 * @returns True when the value is an array.
 */
export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}
