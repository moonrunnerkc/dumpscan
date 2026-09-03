# 0002. Fuzz corpora are seeded, not random

Status: accepted
Date: 2026-09-03

## Context

The build guide asks for a fuzz target that compares the JCS implementation to a
second independent one. The obvious way to generate cases is `Math.random`, but
`canon` is one of the packages where `Math.random` is banned, and the ban applies
to the test files too because they sit next to the source.

Beyond the lint rule, a randomly seeded fuzz run reports a failure that the next
run cannot reproduce. For a project whose entire claim is that a result can be
re-derived from its inputs, a test suite that cannot re-derive its own failures is
the wrong shape.

## Decision

Fuzz generators use xorshift32 with a fixed list of seeds committed in the test.
`canon` runs ten seeds of a thousand cases each, so a run covers ten thousand
values and any failure names the seed and case index that produced it.

Broadening coverage means adding a seed to the list, which is a reviewable commit,
not a lucky night in CI.

## Consequences

A given commit always tests the same ten thousand values, so the suite finds new
bugs only when the generator or the seed list changes. That is an acceptable
trade: the differential check against a second implementation is what catches
divergence, and its value comes from the breadth of the character and number
pools, which are chosen deliberately rather than sampled. The pools include lone
surrogates, composition-excluded presentation forms, C0 and C1 controls, U+2028,
the byte-order mark, and the number forms RFC 8785 calls out.
