export { matchAdvisory } from './advisory-match.js';
export { MATCHER_VERSION, matchManifest } from './engine.js';
export type { MatchResult } from './engine.js';
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
