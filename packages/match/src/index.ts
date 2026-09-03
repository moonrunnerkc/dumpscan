export { matchAdvisory } from './advisory-match.js';
export { MATCHER_VERSION, matchManifest } from './engine.js';
export type { MatchOptions, MatchResult } from './engine.js';
export {
  activeExclusions,
  compareInstants,
  EXCLUSIONS_VERSION,
  exclusionsToJson,
  parseExclusions,
} from './exclusions.js';
export type { Exclusion, Exclusions } from './exclusions.js';
export {
  compareFindings,
  findingLeaves,
  findingLeafHash,
  findingsRoot,
  findingToJson,
} from './finding.js';
export type { Finding, FindingStatus, MatchedRange } from './finding.js';
export { evaluateRange, FROM_THE_BEGINNING, rangeVersions, sortEvents } from './range.js';
export type { RangeBounds, RangeVerdict } from './range.js';
