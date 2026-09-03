import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { parseJson } from '@dumpscan/canon';
import { describe, expect, it } from 'vitest';

import { isKnownEcosystem, parseExternalReport } from './external.js';

const SCANNERS = fileURLToPath(new URL('../../../fixtures/scanners', import.meta.url));
const read = (name: string): ReturnType<typeof parseExternalReport> =>
  parseExternalReport(parseJson(readFileSync(`${SCANNERS}/${name}`, 'utf8')), name);

describe('parseExternalReport on Grype', () => {
  const findings = read('grype.json');

  it('detects the scanner from the document rather than being told', () => {
    expect(findings.every((finding) => finding.scanner === 'grype')).toBe(true);
  });

  it('reads the package, the version, and the purl the scanner recorded', () => {
    const entry = findings.find((finding) => finding.id === 'CVE-2024-90001');
    expect(entry?.name).toBe('cheeseparser');
    expect(entry?.version).toBe('4.17.20');
    expect(entry?.purl).toBe('pkg:npm/cheeseparser@4.17.20');
    expect(entry?.ecosystem).toBe('npm');
  });

  it('carries the related vulnerabilities as aliases', () => {
    expect(findings.find((finding) => finding.id === 'CVE-2024-90001')?.aliases).toStrictEqual([
      'GHSA-aaaa-bbbb-cccc',
    ]);
  });

  it('carries which identifier the scanner matched on', () => {
    expect(findings.find((finding) => finding.id === 'CVE-2019-11111')?.matchedOn).toBe(
      'cpe-match',
    );
    expect(findings.find((finding) => finding.id === 'CVE-2024-90001')?.matchedOn).toBe(
      'exact-direct-match',
    );
  });

  it('maps the artifact type to an ecosystem, and reports null for one it does not know', () => {
    expect(findings.find((finding) => finding.id === 'CVE-2019-11111')?.ecosystem).toBeNull();
  });

  it('orders by package, version, then identifier', () => {
    const keys = findings.map((finding) => `${finding.name} ${finding.version} ${finding.id}`);
    expect([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toStrictEqual(keys);
  });
});

describe('parseExternalReport on Trivy', () => {
  const findings = read('trivy.json');

  it('reads the package identifier and the data source', () => {
    const entry = findings.find((finding) => finding.name === 'cheeseparser');
    expect(entry?.scanner).toBe('trivy');
    expect(entry?.purl).toBe('pkg:npm/cheeseparser@4.17.20');
    expect(entry?.matchedOn).toBe('ghsa');
    expect(entry?.severity).toBe('HIGH');
    expect(entry?.ecosystem).toBe('npm');
  });
});

describe('parseExternalReport derivations and refusals', () => {
  it('derives a purl when the scanner did not record one', () => {
    const derived = parseExternalReport(
      {
        matches: [
          {
            vulnerability: { id: 'CVE-1', severity: 'Low' },
            artifact: { name: 'Widget', version: '1.0.0', type: 'npm' },
          },
        ],
      },
      'inline',
    );
    expect(derived[0]?.purl).toBe('pkg:npm/widget@1.0.0');
  });

  it('reports a null purl when it cannot derive one either', () => {
    const derived = parseExternalReport(
      {
        matches: [
          {
            vulnerability: { id: 'CVE-1' },
            artifact: { name: 'thing', version: '1.0.0', type: 'apk' },
          },
        ],
      },
      'inline',
    );
    expect(derived[0]?.purl).toBeNull();
    expect(derived[0]?.matchedOn).toBe('unknown');
    expect(derived[0]?.severity).toBe('Unknown');
  });

  it('reports a null purl when the coordinate cannot become one', () => {
    const derived = parseExternalReport(
      {
        Results: [
          {
            Type: 'pom',
            Vulnerabilities: [
              { VulnerabilityID: 'CVE-1', PkgName: 'no-colon-here', InstalledVersion: '1.0' },
            ],
          },
        ],
      },
      'inline',
    );
    expect(derived[0]?.purl).toBeNull();
  });

  it('skips entries that name no package or no vulnerability', () => {
    expect(
      parseExternalReport({ matches: ['x', {}, { vulnerability: { id: 'a' } }] }, 'inline'),
    ).toStrictEqual([]);
    expect(
      parseExternalReport(
        { Results: ['x', { Type: 'npm' }, { Type: 'npm', Vulnerabilities: [{}] }] },
        'inline',
      ),
    ).toStrictEqual([]);
  });

  it('refuses a document that is neither scanner', () => {
    expect(() => parseExternalReport({ findings: [] }, 'report.json')).toThrow(
      /neither a Grype matches array nor a Trivy Results array/,
    );
    expect(() => parseExternalReport([], 'report.json')).toThrow(/is not a JSON object/);
  });
});

describe('isKnownEcosystem', () => {
  it('accepts the ecosystems dumpscan scans', () => {
    expect(isKnownEcosystem('npm')).toBe(true);
    expect(isKnownEcosystem('Debian')).toBe(false);
  });
});
