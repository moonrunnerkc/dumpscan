/**
 * The Certificate Transparency reference entries and the RFC 6962 tree heads
 * they produce, used across the merkle test suite. Kept in one place so a
 * single typo cannot make two tests agree with each other and with nothing else.
 */
export const CT_ENTRIES: readonly string[] = [
  '',
  '00',
  '10',
  '2021',
  '3031',
  '40414243',
  '5051525354555657',
  '606162636465666768696a6b6c6d6e6f',
];

/** Tree head for each prefix of {@link CT_ENTRIES}, indexed by tree size. */
export const CT_ROOTS: readonly string[] = [
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
  'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
  'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
  'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
  '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
  '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
  'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
  '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
];

/** Audit paths for two leaves of the full eight entry tree. */
export const CT_INCLUSION: readonly { readonly index: number; readonly path: readonly string[] }[] =
  [
    {
      index: 0,
      path: [
        '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
        '5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e',
        '6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4',
      ],
    },
    {
      index: 5,
      path: [
        'bc1a0643b12e4d2d7c77918f44e0f4f79a838b6cf9ec5b5c283e1f4d88599e6b',
        'ca854ea128ed050b41b35ffc1b87b8eb2bde461e9e3b5596ece6b9d5975a0ae0',
        'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
      ],
    },
  ];

/** Consistency paths between prefixes of the eight entry tree. */
export const CT_CONSISTENCY: readonly {
  readonly first: number;
  readonly second: number;
  readonly path: readonly string[];
}[] = [
  { first: 1, second: 1, path: [] },
  {
    first: 1,
    second: 8,
    path: [
      '96a296d224f285c67bee93c30f8a309157f0daa35dc5b87e410b78630a09cfc7',
      '5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e',
      '6b47aaf29ee3c2af9af889bc1fb9254dabd31177f16232dd6aab035ca39bf6e4',
    ],
  },
  {
    first: 6,
    second: 8,
    path: [
      '0ebc5d3437fbe2db158b9f126a1d118e308181031d0a949f8dededebc558ef6a',
      'ca854ea128ed050b41b35ffc1b87b8eb2bde461e9e3b5596ece6b9d5975a0ae0',
      'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
    ],
  },
  {
    first: 2,
    second: 5,
    path: [
      '5f083f0a1a33ca076a95279832580db3e0ef4584bdff1f54c8a360f50de3031e',
      'bc1a0643b12e4d2d7c77918f44e0f4f79a838b6cf9ec5b5c283e1f4d88599e6b',
    ],
  },
  {
    first: 3,
    second: 7,
    path: [
      '0298d122906dcfc10892cb53a73992fc5b9f493ea4c9badb27b791b4127a7fe7',
      '07506a85fd9dd2f120eb694f86011e5bb4662e5c415a62917033d4a9624487e7',
      'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
      '837dbb152e9b079010717e84e865da4ebc0fa198a806d59d31bf15accef22d0e',
    ],
  },
  {
    first: 4,
    second: 7,
    path: ['837dbb152e9b079010717e84e865da4ebc0fa198a806d59d31bf15accef22d0e'],
  },
  {
    first: 6,
    second: 7,
    path: [
      '0ebc5d3437fbe2db158b9f126a1d118e308181031d0a949f8dededebc558ef6a',
      'b08693ec2e721597130641e8211e7eedccb4c26413963eee6c1e2ed16ffb1a5f',
      'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
    ],
  },
];

/**
 * Decodes a lowercase hex string into bytes. The merkle package has no
 * dependencies, so the test suite carries its own decoder.
 *
 * @param hex - Even length lowercase hex.
 * @returns The decoded bytes.
 */
export function bytesFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Renders bytes as lowercase hex.
 *
 * @param bytes - The bytes to render.
 * @returns Lowercase hex.
 */
export function hexFromBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
