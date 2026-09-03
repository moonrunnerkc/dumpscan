# CLAUDE.md

dumpscan is a vulnerability scanner whose every result is a reproducible, signed claim. Read `docs/build-guide.md` before touching anything. It is the specification; this file is the working agreement.

## What this project is

Input: a lockfile plus a pinned OSV feed snapshot. Output: findings plus an in-toto predicate binding those findings to four digests (input manifest, feed, comparator ruleset, exclusions), signed with Sigstore. Anyone can replay the scan and get identical bytes or a diff that names exactly which digest moved.

The determinism guarantee is the product. Every design decision defers to it.

## Non-negotiable rules

- Named exports only. No default exports anywhere, including config files where the tool allows named alternatives.
- kebab-case filenames. `feed-snapshot.ts`, never `feedSnapshot.ts` or `FeedSnapshot.ts`.
- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Never disable a strict flag, never `// @ts-ignore`, never `as any`. `as unknown as T` requires a comment explaining why the type system cannot express the invariant.
- 300-line limit per file, including tests. Split before you hit it.
- No em dashes anywhere: code, comments, docs, commit messages, error strings. Use commas, colons, or separate sentences.
- No AI attribution trailers on commits. No `Co-Authored-By`, no `Generated-by`, no session links.
- ESM only. Node 22 baseline. No native modules. WASM is acceptable when pure JS is too slow (zstd).

## Determinism rules

These are enforced by tests, but you must also reason about them while writing.

- `canon`, `merkle`, `versions`, `match`, and `predicate` are pure. No `Date.now()`, no `Math.random()`, no `process.env`, no filesystem, no network, no `Intl`, no locale-sensitive string methods (`toLocaleLowerCase`, `localeCompare`). Use `toLowerCase` and code-unit comparison.
- All JSON that gets hashed goes through `canon` first. Never hash `JSON.stringify` output directly.
- All string input that gets hashed is NFC-normalized first.
- Sorting is always by explicit comparator on canonical bytes or code units. Never rely on default `Array.prototype.sort` ordering for objects, and never rely on `Map` or object key insertion order for output.
- Digest format is `sha256:<lowercase hex>` everywhere. One helper in `canon` produces it. Nothing else formats digests.
- The predicate body contains no timestamp except `evaluationTime`, and that field exists only when an exclusions file contains an expiry.
- If you find yourself needing the current time anywhere outside `sign` and the exclusions expiry check, stop and re-read the build guide.

## Repository layout

pnpm workspace. Packages under `packages/`:

`canon`, `merkle`, `osv`, `lockfiles`, `versions`, `match`, `predicate`, `sign`, `diff`, `explain`, `cli`, `action`.

Dependency direction is strictly downward:

```
cli, action
  -> diff, explain, sign
    -> predicate, match
      -> osv, lockfiles, versions
        -> merkle, canon
```

`canon` and `merkle` have zero runtime dependencies. A PR that adds a dependency to either is rejected.

Fixtures live in `fixtures/` at the repo root: `lockfiles/<format>/`, `osv/` (small synthetic snapshots with known roots), `versions/<ecosystem>/corpus.json`, `bundles/` (historical bundles for replay tests).

## Testing rules

- Test runner is `vitest`. Test files sit next to source as `<name>.test.ts`.
- Every lockfile parser has a golden test: fixture in, exact canonical manifest out. Update goldens only with a commit message explaining why the parse changed.
- Every comparator has a property test (antisymmetry, transitivity) and a corpus test against `fixtures/versions/<ecosystem>/corpus.json`. Changing a corpus file changes `comparatorRulesetDigest`; the commit message must say so.
- `match` has a replay test: fixture lockfile plus fixture snapshot must produce the findings root recorded in `fixtures/bundles/`. If the root changes, you changed matching semantics. Bump `matcherVersion` and explain.
- Byte-identity: CI runs the fixture corpus on ubuntu, macos, windows and diffs findings bytes. Locally, run `pnpm test:determinism`, which runs the corpus twice with different `TZ` and `LANG` and diffs.
- Mutation testing (Stryker) on `versions` and `match`. Floor is 90 percent mutation score. Do not lower the floor.
- Coverage floor 85 percent on `canon`, `merkle`, `versions`, `match`, `predicate`. Do not lower the floor.
- No snapshot tests of large objects. Golden files are explicit fixtures you can read.
- No mocking of `canon` or `merkle`. They are fast and pure; use them directly.

## Commit conventions

Conventional commits, scope is the package name: `feat(match): evaluate ECOSYSTEM ranges for PyPI`. Body explains what changed and, when relevant, which digest it moves. One logical change per commit. No trailers.

## Definition of done for any task

1. `pnpm typecheck` clean.
2. `pnpm lint` clean (eslint with the repo config; no rule disables without a comment).
3. `pnpm test` green, including determinism run.
4. Coverage and mutation floors held.
5. No file over 300 lines.
6. `pnpm build` produces the CLI and it runs `dumpscan --help`.
7. If a public behavior changed, `docs/build-guide.md` or the README says so in the same commit.

## Things that look reasonable and are wrong here

- Adding `--latest` to `scan` to pick the newest snapshot automatically. No. Reproducibility is the default; the caller pins a digest.
- Dropping excluded or withdrawn findings from the findings file. No. They stay with a status so the root is complete and `diff` can attribute.
- Wrapping Grype or Trivy to get matching "for free". No. Their nondeterminism becomes ours. `explain` reads their output; nothing else touches them.
- Storing the snapshot as one big JSON array. No. Content-addressed record files plus a manifest, so inclusion proofs work and partial fetches are possible.
- Using a semver library's `satisfies` for OSV ranges. No. OSV ranges are event lists (introduced, fixed, last_affected, limit) and must be evaluated as such per the OSV schema.
- Putting the scan timestamp in the predicate body "for convenience". No. It goes in the envelope.

## When you are unsure

Re-read the relevant section of `docs/build-guide.md`. If the guide is silent, choose the option that keeps the output byte-identical across machines, and write down the choice in a short ADR under `docs/decisions/`.
