# Build progress

One line per completed phase: date, commit, gate result.

| Phase              | Date       | Commit  | Gate                                                                                        |
| ------------------ | ---------- | ------- | ------------------------------------------------------------------------------------------- |
| 0 scaffold         | 2026-09-03 | 07005ae | typecheck, lint, test, determinism, build green; CI workflow present                        |
| 1 canon and merkle | 2026-09-03 | 3d20fab | 91 tests green; canon and merkle at 100 percent coverage, zero dependencies; JCS fuzz green |
| 2 osv snapshot     | 2026-09-03 | 8ada6b2 | 162 tests green; fixture snapshot reproduces sha256:77f3f140 in two directories             |
| 3 lockfiles and versions | 2026-09-03 | 97f7f38 | 344 tests green; 13 lockfile goldens; versions mutation score 96.52 percent |
