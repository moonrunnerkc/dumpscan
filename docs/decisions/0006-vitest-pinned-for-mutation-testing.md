# 0006. vitest is pinned to 3.2.7

Status: accepted
Date: 2026-09-03

## Context

The repository was scaffolded on vitest 5.0.0. The whole test suite passes on it,
but Stryker's vitest runner reports a mutation score of zero: every mutant is
recorded as covered by tests, the tests run, and not one mutant is killed.
Activating a mutant by hand inside Stryker's own sandbox kills the tests as
expected, so the instrumentation is fine and the runner's mutant activation is
what does not reach the test process.

`@stryker-mutator/vitest-runner@10.0.0` declares `vitest >= 2.0.0`, which vitest
5 satisfies on paper.

## Decision

Pin vitest and `@vitest/coverage-v8` to 3.2.7. On that version the same
configuration reports a real score in the same run time, and the surviving
mutants are ones a reviewer can look at and act on.

The alternative, Stryker's `command` runner, does work on vitest 5, but it runs
the whole suite per mutant with no coverage analysis. On the versions package
alone that is a twenty minute gate instead of a one minute one, which is a gate
nobody runs.

## Consequences

The mutation floor is enforceable, which is the point of having one. The cost is
that dumpscan is a version behind on its test runner. Revisit when
`@stryker-mutator/vitest-runner` ships support for vitest 5; the fix is to bump
two devDependencies and delete this file.
