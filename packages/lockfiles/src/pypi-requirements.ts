import { buildManifest, inputPackage, ROOT_WORKSPACE } from './manifest.js';
import type { InputPackage } from './manifest.js';
import { UnpinnedLockfileError } from './parser.js';
import type { LockfileParser, ParsedLockfile, ParseInput } from './parser.js';

/** `name[extras]==version` with an optional environment marker. */
const PINNED = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*===?\s*([^\s;#]+)\s*(;.*)?$/;

/**
 * Parses a fully pinned `requirements.txt`.
 *
 * A requirements file is a install command, not a lockfile: `requests>=2` names
 * a range that resolves differently every day. dumpscan reads one only when
 * every requirement is pinned with `==` or `===`, and refuses otherwise with the
 * line that has to change. Extras and environment markers are allowed because
 * neither affects which version is installed; `--hash` lines and continuations
 * are joined and ignored.
 */
export const requirementsParser: LockfileParser = {
  format: 'requirements.txt',
  filenames: ['requirements.txt'],
  parse,
};

function parse(input: ParseInput): ParsedLockfile {
  const packages: InputPackage[] = [];

  for (const { text, line } of logicalLines(input.text)) {
    const stripped = stripHashes(text);
    if (stripped === '') continue;

    if (stripped.startsWith('-') || stripped.startsWith('--')) {
      throw new UnpinnedLockfileError(
        `requirements.txt: ${input.filename} line ${line} is ${JSON.stringify(stripped)}; dumpscan does not follow options or included files, so pass the resolved requirements file produced by pip-compile or uv pip compile`,
      );
    }

    const match = PINNED.exec(stripped);
    const version = match?.[3];
    const name = match?.[1];
    if (match === null || name === undefined || version === undefined) {
      throw new UnpinnedLockfileError(
        `requirements.txt: ${input.filename} line ${line} is ${JSON.stringify(stripped)}, which does not pin an exact version; dumpscan reads a requirements file only when every line uses == so the scan is reproducible`,
      );
    }
    if (version.includes('*')) {
      throw new UnpinnedLockfileError(
        `requirements.txt: ${input.filename} line ${line} pins ${JSON.stringify(version)}, which is a prefix match and not an exact version; write the full version instead`,
      );
    }
    packages.push(inputPackage('PyPI', name, version));
  }

  const format = 'requirements.txt pinned';
  return {
    format,
    manifests: [
      buildManifest({
        format,
        lockfileDigest: input.lockfileDigest,
        workspaceRoot: ROOT_WORKSPACE,
        overApproximated: false,
        packages,
        unresolved: [],
      }),
    ],
  };
}

function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let buffer = '';
  let start = 0;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = (lines[i] as string).replace(/\r$/, '');
    const withoutComment = raw.replace(/(^|\s)#.*$/, '$1').trim();
    if (buffer === '') start = i + 1;
    if (withoutComment.endsWith('\\')) {
      buffer += `${withoutComment.slice(0, -1).trim()} `;
      continue;
    }
    const joined = `${buffer}${withoutComment}`.trim();
    buffer = '';
    if (joined !== '') out.push({ text: joined, line: start });
  }
  if (buffer.trim() !== '') out.push({ text: buffer.trim(), line: start });
  return out;
}

function stripHashes(text: string): string {
  return text.replace(/\s--hash=\S+/g, '').trim();
}
