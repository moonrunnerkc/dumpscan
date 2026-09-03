import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSnapshot, ECOSYSTEMS, isEcosystem } from '@dumpscan/osv';
import type { Ecosystem, SnapshotSource } from '@dumpscan/osv';
import { downloadEcosystems } from '@dumpscan/osv/download';

import type { ParsedArgs } from './args.js';
import { EXIT_OK, UsageError } from './exit.js';
import type { CommandOutput } from './output.js';

/**
 * Runs `dumpscan snapshot`.
 *
 * Downloading and building are separate steps on purpose: the builder has to be
 * a pure function of the bytes on disk for the feed digest to mean anything.
 * `--from` names a directory of OSV records to build from without touching the
 * network; without it the archives are fetched first and the ETag and
 * Last-Modified observed are recorded in the manifest.
 *
 * @param args - Parsed arguments.
 * @returns Exit code, human lines, and the manifest summary.
 * @throws UsageError when an ecosystem name is not one dumpscan scans.
 */
export async function runSnapshot(args: ParsedArgs): Promise<CommandOutput> {
  const ecosystems = selectEcosystems(args);
  const out = args.options.get('out') ?? 'dumpscan-snapshot';
  const from = args.options.get('from');

  let recordsDir: string;
  let sources: Partial<Record<Ecosystem, SnapshotSource>> = {};

  if (from !== undefined && from !== '') {
    if (!existsSync(from)) {
      throw new UsageError(`dumpscan snapshot: ${from} does not exist`);
    }
    recordsDir = from;
  } else {
    recordsDir = mkdtempSync(join(tmpdir(), 'dumpscan-osv-'));
    const baseUrl = args.options.get('base-url');
    const downloaded = await downloadEcosystems({
      ecosystems,
      outDir: recordsDir,
      ...(baseUrl === undefined || baseUrl === '' ? {} : { baseUrl }),
    });
    sources = Object.fromEntries(downloaded.map((entry) => [entry.ecosystem, entry.source]));
  }

  const built = buildSnapshot(recordsDir, out, { ecosystems, sources });

  return {
    exitCode: EXIT_OK,
    lines: [
      `feed digest   ${built.feedDigest}`,
      `manifest      ${built.manifestDigest}`,
      `records       ${String(built.recordsWritten)} written, ${String(built.recordsSkipped)} skipped`,
      ...built.manifest.ecosystems.map(
        (entry) =>
          `  ${entry.ecosystem.padEnd(12)}${String(entry.recordCount)} records  ${entry.root}`,
      ),
      `snapshot      ${out}`,
    ],
    json: {
      feedDigest: built.feedDigest,
      snapshotManifestDigest: built.manifestDigest,
      recordsWritten: built.recordsWritten,
      recordsSkipped: built.recordsSkipped,
      out,
    },
  };
}

function selectEcosystems(args: ParsedArgs): Ecosystem[] {
  const requested = args.repeated.get('ecosystems') ?? [];
  const names = requested.flatMap((value) => value.split(',')).filter((name) => name !== '');
  if (names.length === 0) return [...ECOSYSTEMS];

  return names.map((name) => {
    if (!isEcosystem(name)) {
      throw new UsageError(
        `dumpscan snapshot: ${JSON.stringify(name)} is not an ecosystem dumpscan scans; it reads ${ECOSYSTEMS.join(', ')}`,
      );
    }
    return name;
  });
}
