import { isJsonArray, isJsonObject } from '@dumpscan/canon';
import type { JsonObject, JsonValue } from '@dumpscan/canon';

/**
 * The JSON Schema keywords dumpscan's published schema uses. Deliberately a
 * small subset: the schema is written alongside the validator, so supporting
 * keywords nothing uses would only be surface for the validator to be wrong on.
 */
const SUPPORTED = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'pattern',
  'minimum',
  'minItems',
  'uniqueItems',
]);

export interface ValidationError {
  /** JSON Pointer to the offending node. */
  readonly path: string;
  readonly message: string;
}

/**
 * Validates a value against a JSON Schema.
 *
 * @param schema - The schema.
 * @param value - The value to check.
 * @returns Every error found, in document order. Empty when the value is valid.
 * @throws Error when the schema uses a keyword this validator does not implement.
 */
export function validate(schema: JsonObject, value: JsonValue): ValidationError[] {
  const errors: ValidationError[] = [];
  check(schema, value, '', errors);
  return errors;
}

/**
 * Renders validation errors as one message.
 *
 * @param errors - Errors from {@link validate}.
 * @returns A single line naming each offending path.
 */
export function describeErrors(errors: readonly ValidationError[]): string {
  return errors
    .map((error) => `${error.path === '' ? '(root)' : error.path}: ${error.message}`)
    .join('; ');
}

function check(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) {
      throw new Error(
        `validate: schema at ${path === '' ? '(root)' : path} uses the keyword ${JSON.stringify(keyword)}, which dumpscan's validator does not implement; add it to validate.ts or express the constraint with a keyword that is implemented`,
      );
    }
  }

  const declared = schema['type'];
  if (declared !== undefined && !matchesDeclaredType(declared, value)) {
    errors.push({ path, message: `expected ${renderType(declared)}, found ${describe(value)}` });
    return;
  }

  checkConst(schema, value, path, errors);
  checkEnum(schema, value, path, errors);
  checkString(schema, value, path, errors);
  checkNumber(schema, value, path, errors);
  checkArray(schema, value, path, errors);
  checkObject(schema, value, path, errors);
}

function checkConst(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  const expected = schema['const'];
  if (expected === undefined) return;
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    errors.push({ path, message: `expected the constant ${JSON.stringify(expected)}` });
  }
}

function checkEnum(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  const options = schema['enum'];
  if (!isJsonArray(options)) return;
  const rendered = JSON.stringify(value);
  if (!options.some((option) => JSON.stringify(option) === rendered)) {
    errors.push({ path, message: `expected one of ${JSON.stringify(options)}` });
  }
}

function checkString(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  const pattern = schema['pattern'];
  if (typeof pattern !== 'string' || typeof value !== 'string') return;
  if (!new RegExp(pattern, 'u').test(value)) {
    errors.push({ path, message: `${JSON.stringify(value)} does not match ${pattern}` });
  }
}

function checkNumber(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  const minimum = schema['minimum'];
  if (typeof minimum !== 'number' || typeof value !== 'number') return;
  if (value < minimum) {
    errors.push({ path, message: `${value} is below the minimum ${minimum}` });
  }
}

function checkArray(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  if (!isJsonArray(value)) return;

  const minItems = schema['minItems'];
  if (typeof minItems === 'number' && value.length < minItems) {
    errors.push({ path, message: `expected at least ${minItems} items, found ${value.length}` });
  }

  if (schema['uniqueItems'] === true) {
    const seen = new Set(value.map((item) => JSON.stringify(item)));
    if (seen.size !== value.length) {
      errors.push({ path, message: 'expected every item to be distinct' });
    }
  }

  const items = schema['items'];
  if (isJsonObject(items)) {
    value.forEach((item, index) => {
      check(items, item, `${path}/${index}`, errors);
    });
  }
}

function checkObject(
  schema: JsonObject,
  value: JsonValue,
  path: string,
  errors: ValidationError[],
): void {
  if (!isJsonObject(value)) return;

  const required = schema['required'];
  if (isJsonArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) {
        errors.push({ path, message: `missing required property ${JSON.stringify(key)}` });
      }
    }
  }

  const properties = isJsonObject(schema['properties']) ? schema['properties'] : {};
  for (const [key, member] of Object.entries(value)) {
    const subschema = properties[key];
    if (isJsonObject(subschema)) {
      check(subschema, member, `${path}/${escapePointer(key)}`, errors);
    } else if (schema['additionalProperties'] === false) {
      errors.push({ path, message: `unexpected property ${JSON.stringify(key)}` });
    }
  }
}

function matchesDeclaredType(declared: JsonValue, value: JsonValue): boolean {
  if (isJsonArray(declared)) {
    return declared.some((option) => typeof option === 'string' && matchesType(option, value));
  }
  if (typeof declared !== 'string') {
    throw new Error(
      `validate: schema declares type ${JSON.stringify(declared)}, which is neither a type name nor a list of them`,
    );
  }
  return matchesType(declared, value);
}

function renderType(declared: JsonValue): string {
  if (isJsonArray(declared)) {
    return declared.filter((option): option is string => typeof option === 'string').join(' or ');
  }
  return typeof declared === 'string' ? declared : JSON.stringify(declared);
}

function matchesType(declared: string, value: JsonValue): boolean {
  switch (declared) {
    case 'object':
      return isJsonObject(value);
    case 'array':
      return isJsonArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new Error(
        `validate: schema declares type ${JSON.stringify(declared)}, which is not a JSON Schema type`,
      );
  }
}

function describe(value: JsonValue): string {
  if (value === null) return 'null';
  if (isJsonArray(value)) return 'array';
  if (isJsonObject(value)) return 'object';
  return typeof value;
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
