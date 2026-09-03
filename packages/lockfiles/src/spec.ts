/**
 * Splits a `name@version` specifier where the name may itself start with `@`.
 * npm scopes, pnpm package keys, and yarn descriptors all use this shape, and
 * splitting on the first `@` gets `@scope/pkg` wrong.
 *
 * @param spec - A specifier such as `lodash@4.17.21` or `@scope/pkg@1.0.0`.
 * @returns The name and version, or null when there is no separating `@`.
 */
export function splitNameAndVersion(spec: string): { name: string; version: string } | null {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return null;
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (name === '' || version === '') return null;
  return { name, version };
}

/**
 * Strips the protocol from a yarn descriptor, so `lodash@npm:^4.17.20` reduces
 * to the name `lodash` and the range `^4.17.20`.
 *
 * @param spec - A yarn descriptor.
 * @returns The name and the range with any protocol removed, or null when the
 * descriptor has no version part.
 */
export function splitYarnDescriptor(
  spec: string,
): { name: string; protocol: string | null; range: string } | null {
  const split = splitNameAndVersion(spec.trim().replace(/^"|"$/g, ''));
  if (split === null) return null;
  const colon = split.version.indexOf(':');
  if (colon === -1) return { name: split.name, protocol: null, range: split.version };
  return {
    name: split.name,
    protocol: split.version.slice(0, colon),
    range: split.version.slice(colon + 1),
  };
}
