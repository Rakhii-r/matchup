/**
 * Master Test Suite Runner
 * Executes all Tier 1-4 tests covering:
 * - Tier 1: Feature Coverage (F1-F5)
 * - Tier 2: Boundary & Corner Cases
 * - Tier 3: Cross-Feature Combinations
 * - Tier 4: Real-World Scenarios
 * 
 * Usage:
 *   node --loader ts-node/esm tests/runTests.ts
 *   or:
 *   npx tsx tests/runTests.ts
 *   or:
 *   node --test tests/tier1_features/*.test.ts
 */

import './tier1_features/geoTargetedNotifications.test';
import './tier1_features/globalMatchDiscovery.test';
import './tier1_features/offersDeduplication.test';
import './tier2_boundaries/boundaryAndEdgeCases.test';
import './tier2_boundaries/adversarialStressTests.test';
import './tier3_cross_features/crossFeatureWorkflows.test';
import './tier4_real_world/multiSquadLeagueWorkflow.test';
