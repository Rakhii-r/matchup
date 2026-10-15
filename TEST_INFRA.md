# E2E Test Infrastructure: Venue Slot Booking, Court Selection & Concurrency Protection

## 1. Overview & Architectural Philosophy

This test framework validates the end-to-end functionality, data integrity, and strict concurrency guarantees of venue time slot bookings, court selection, and double-booking prevention in MatchUp.

### Key Tenets
1. **Opaque-Box & Requirement-Driven**: Tests assert directly against the business specifications and database contracts defined in `ORIGINAL_REQUEST.md` and `PROJECT.md`, treating internal implementation details as black boxes.
2. **Deterministic Concurrency & Temporal Isolation**: A specialized in-memory PostgreSQL engine (`VenueBookingHarness`) replicates exact database semantics:
   - Partial GiST exclusion constraints (`tstzrange` with `[)` half-open interval semantics).
   - SQLSTATE error mapping (`23P01`, `28000`, `42501`, `P0002`, `23514`).
   - Stored procedures: `get_venue_slots`, `book_venue_slot`, `cancel_venue_booking`.
   - Match ground linking and detachment atomicity.
3. **No External Flakiness**: Built using Node.js's native test runner (`node:test` and `node:assert/strict`), ensuring sub-second execution, deterministic reproducibility, and zero dependency on remote networks.

---

## 2. Directory Layout & Test Suite Structure

```
tests/e2e/
├── harness/
│   └── venueBookingHarness.ts            # High-fidelity in-memory Postgres harness & RPC engine
├── tier1_features/
│   ├── venueSlotCalculation.test.ts      # Tier 1: F1 (Dynamic calculation), F2 (Court segmentation), F3 (Status)
│   └── venueBookingRpc.test.ts           # Tier 1: F4 (Atomic booking), F5 (Cancellation), F6 (Match linking)
├── tier2_boundaries/
│   └── boundaryAndCornerCases.test.ts    # Tier 2: Limits, [) half-open intervals, past slots, court extremes, invalid inputs
├── tier3_cross_features/
│   └── concurrencyAndInteractions.test.ts# Tier 3: Concurrency races, multi-court isolation, re-booking churn, detachment
├── tier4_real_world/
│   └── realisticVenueWorkload.test.ts    # Tier 4: Tournament simulation, prime-time saturation, invariant conservation
└── run_e2e_tests.ts                      # Master E2E test runner
```

---

## 3. Feature Inventory Coverage Matrix

| Feature ID | Feature Name | Tier | Test File | Test IDs | Coverage Details |
|---|---|---|---|---|---|
| **F1** | Venue Operating Settings & Dynamic Slots | Tier 1 | `venueSlotCalculation.test.ts` | `F1.1` - `F1.6` | 06:00-23:00 60-min slots (17/court), 30-min slots, 90-min slots, 45-min stepping, interval contiguity, venue validation |
| **F2** | Court / Box Slot Segmentation | Tier 1 | `venueSlotCalculation.test.ts` | `F2.1` - `F2.6` | Court 1 vs Court 2 isolation, independent booking states, 4-court generation, court sorting, single-court generation |
| **F3** | Slot Status Differentiation | Tier 1 | `venueSlotCalculation.test.ts` | `F3.1` - `F3.7` | Available vs Booked vs Past, booking_id assignment, is_my_booking ownership, past dates, cancellation restoration, 5-min grace period |
| **F4** | Atomic Slot Booking RPC (`book_venue_slot`) | Tier 1 | `venueBookingRpc.test.ts` | `F4.1` - `F4.7` | Confirmed record persistence, null notes handling, multi-slot bookings, auth check (`28000`), active account check (`42501`), notes limit (`23514`), venue validation (`P0002`) |
| **F5** | Booking Cancellation RPC (`cancel_venue_booking`) | Tier 1 | `venueBookingRpc.test.ts` | `F5.1` - `F5.7` | Booker cancellation, instant slot release from GiST index, non-booker rejection (`42501`), admin permission, idempotency, non-existent booking (`P0002`), unauthenticated caller |
| **F6** | Match Linking & Detachment Lifecycle | Tier 1 | `venueBookingRpc.test.ts` | `F6.1` - `F6.7` | Atomic match update (`venue_id`, `venue_text`, timestamps), captain chat announcement, non-organiser rejection (`42501`), sport mismatch check (`23514`), match validation, cancellation detachment |
| **B1** | Operating Limit Boundaries | Tier 2 | `boundaryAndCornerCases.test.ts` | `B1.1` - `B1.5` | Earliest slot (06:00), latest slot (22:00-23:00), out-of-bounds closing exclusion, multi-court parallel boundaries, 30-min boundary stepping |
| **B2** | Adjacent Back-to-Back & Half-Open Semantics | Tier 2 | `boundaryAndCornerCases.test.ts` | `B2.1` - `B2.6` | `[)` half-open boundary sharing (10:00-11:00 & 11:00-12:00), reverse order booking, partial overlap rejection (`23P01`), enclosing overlap rejection, sub-interval overlap, sandwich slot booking |
| **B3** | Past Time Slots & Grace Window | Tier 2 | `boundaryAndCornerCases.test.ts` | `B3.1` - `B3.5` | Yesterday rejection, >5 min past rejection (`23514`), within 5-min grace acceptance, >5 min threshold boundary, grid past marking |
| **B4** | Single-Court vs Multi-Court Extremes | Tier 2 | `boundaryAndCornerCases.test.ts` | `B4.1` - `B4.5` | 1-court booking, 1-court invalid court 2 rejection (`23514`), 4-court parallel booking, 4-court invalid court 5 rejection, 20-court mega venue boundary |
| **B5** | Input Validation & Error Handling | Tier 2 | `boundaryAndCornerCases.test.ts` | `B5.1` - `B5.7` | Court 0 rejection, negative court rejection, reversed time window (`end <= start`), zero duration rejection, non-multiple duration rejection, invalid timestamps (`22007`), venue table check constraints |
| **C1-C8** | Concurrency Protection & Cross-Feature Flows | Tier 3 | `concurrencyAndInteractions.test.ts` | `C1` - `C8` | 2-user simultaneous race (1 winner, 1 `23P01`), 4-court simultaneous independent booking, book-cancel-rebook instant reuse, match link-cancel-relink flow, multi-hour overlapping race, 10-user prime-time race (1 winner, 9 `23P01`), rapid 5-cycle churn, concurrent multi-organizer match linking |
| **W1-W3** | Real-World Workload & Capacity Invariants | Tier 4 | `realisticVenueWorkload.test.ts` | `W1` - `W3` | 4-court full tournament schedule (R1, Semis, Finals, chat announcements), prime-time saturation (100% booked, rejection, opportunistic drop-in pickup), mathematical capacity conservation invariant |

---

## 4. Test Execution Instructions

### Direct Execution
Execute using `tsx` or `node --test`:

```bash
# Execute master test suite runner
npx tsx tests/e2e/run_e2e_tests.ts

# Or execute via Node test runner directly
node --test tests/e2e/**/*.test.ts
```

### Tier-Specific Execution
```bash
# Run Tier 1: Feature Coverage
npx tsx tests/e2e/tier1_features/venueSlotCalculation.test.ts
npx tsx tests/e2e/tier1_features/venueBookingRpc.test.ts

# Run Tier 2: Boundary & Corner Cases
npx tsx tests/e2e/tier2_boundaries/boundaryAndCornerCases.test.ts

# Run Tier 3: Cross-Feature Interactions & Concurrency
npx tsx tests/e2e/tier3_cross_features/concurrencyAndInteractions.test.ts

# Run Tier 4: Real-World Multi-Court Workload
npx tsx tests/e2e/tier4_real_world/realisticVenueWorkload.test.ts
```

---

## 5. Mathematical Properties & Invariant Verification

The harness and tests verify the following formal invariants:
1. **Exclusion Invariant**:
   $$\forall b_1, b_2 \in \text{venue\_bookings} \text{ where } status = \text{'confirmed'}:$$
   $$(b_1.venue\_id = b_2.venue\_id \land b_1.court\_number = b_2.court\_number \land b_1 \neq b_2) \implies [b_1.start, b_1.end) \cap [b_2.start, b_2.end) = \emptyset$$
2. **Boundary Half-Open Invariant**:
   $$[T_1, T_2) \cap [T_2, T_3) = \emptyset$$
   Consecutive adjacent slots do not conflict.
3. **Capacity Conservation Invariant**:
   $$\forall \text{ venue } v, \text{ date } d:$$
   $$|\text{Available Slots}| + |\text{Active Confirmed Slots}| = \left( \frac{\text{operating\_hours\_end} - \text{operating\_hours\_start}}{\text{slot\_duration}} \right) \times \text{courts\_count}$$
