# Build progress

One line per completed phase: date, commit, gate result.

| Phase                                  | Date       | Commit  | Gate                                                                                                                      |
| -------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0 scaffold                             | 2026-09-03 | 07005ae | typecheck, lint, test, determinism, build green; CI workflow present                                                      |
| 1 canon and merkle                     | 2026-09-03 | 3d20fab | 91 tests green; canon and merkle at 100 percent coverage, zero dependencies; JCS fuzz green                               |
| 2 osv snapshot                         | 2026-09-03 | 8ada6b2 | 162 tests green; fixture snapshot reproduces sha256:77f3f140 in two directories                                           |
| 3 lockfiles and versions               | 2026-09-03 | 97f7f38 | 344 tests green; 13 lockfile goldens; versions mutation score 96.52 percent                                               |
| 4 match                                | 2026-09-03 | 5202d90 | 423 tests green; replay fixture reproduces sha256:fe78864f and sha256:c92de6e4; match mutation score 97.44 percent        |
| 5 predicate, sign, verify, prove       | 2026-09-03 | fa0a834 | 550 tests green; end to end signs, verifies offline, and proves inclusion; keyless exercised in CI                        |
| 6 Cargo, Go, Maven, exclusions, replay | 2026-09-03 | cb788cc | 687 tests green; both replay bundles reproduce their roots; match 93.78 percent and versions 93.83 percent mutation score |
| 7 diff and the GitHub Action           | 2026-09-03 | ccf1f3a | 731 tests green; every attribution cause covered by a constructed bundle pair; action exercised in CI                     |
| 8 snapshot publishing and explain | 2026-09-03 | a23d223 | 747 tests green; publish, fetch by digest from a store, and scan with an empty cache all covered end to end |
