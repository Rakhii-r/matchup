/**
 * Master E2E Test Suite Runner for Venue Slot Booking, Court Selection & Concurrency Protection
 * 
 * Executes all 4 tiers of E2E integration tests:
 * - Tier 1: Feature Coverage (Dynamic slot calculation, Court segmentation, Status differentiation, Atomic booking RPC, Cancellation release, Match linking)
 * - Tier 2: Boundary & Corner Cases (Operating limits, [) half-open intervals, Past slots, Court count extremes, Input validation)
 * - Tier 3: Cross-Feature Interactions & Concurrency (Race conditions, Multi-court isolation, Rapid recycle churn, Match detachment)
 * - Tier 4: Real-World Workload (Full-day tournament simulation, Prime-time saturation, Invariant audit)
 * 
 * How to run:
 *   npx tsx tests/e2e/run_e2e_tests.ts
 *   or:
 *   node --test --loader ts-node/esm tests/e2e/**\/*.test.ts
 */

import './tier1_features/venueSlotCalculation.test';
import './tier1_features/venueBookingRpc.test';
import './tier1_features/venueUiComponents.test';
import './tier2_boundaries/boundaryAndCornerCases.test';
import './tier3_cross_features/concurrencyAndInteractions.test';
import './tier3_cross_features/multiTeamMatching.test';
import './tier4_real_world/realisticVenueWorkload.test';
import './tier5_adversarial/challengerAdversarial.test';

console.log('----------------------------------------------------------------------');
console.log('✓ Master E2E Suite Loaded: Tiers 1-5 initialized successfully.');
console.log('  - Tier 1: Feature Coverage (venueSlotCalculation, venueBookingRpc)');
console.log('  - Tier 2: Boundary & Corner Cases (boundaryAndCornerCases)');
console.log('  - Tier 3: Concurrency Protection (concurrencyAndInteractions, multiTeamMatching)');
console.log('  - Tier 4: Real-World Workloads (realisticVenueWorkload)');
console.log('  - Tier 5: Adversarial & Challenger Stress (challengerAdversarial)');
console.log('----------------------------------------------------------------------');

