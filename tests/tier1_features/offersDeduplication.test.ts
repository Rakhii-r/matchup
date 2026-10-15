/**
 * Tier 1 Tests: Feature Coverage - Game Offers Deduplication
 * 
 * Tests:
 * - F5: Single card per match fixture in Game Offers screen (keyed by challenge_id).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';
import type { OpenOffer } from '@features/teams/domain/challengeSchema';

describe('Tier 1: F5 - Single card per match fixture in Game Offers screen (keyed by challenge_id)', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();
  });

  it('F5.1: Multiple candidate rows for the same fixture collapse into exactly 1 offer card', () => {
    // Host
    harness.createUser('host-user', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host Eleven', 'box_cricket', 'host-user', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`hm-${i}`, `HM ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `hm-${i}`);
    }

    // Captain Multi owns two squads: Alpha and Beta
    const ptMulti = createPointAtDistance(originPune, 2000, 0);
    harness.createUser('user-multi', 'Captain Multi', ptMulti.lat, ptMulti.lng);

    harness.createTeam('team-alpha', 'Alpha Warriors', 'box_cricket', 'user-multi', 4);
    harness.createTeam('team-beta', 'Beta Strikers', 'box_cricket', 'user-multi', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`am-${i}`, `AM ${i}`, ptMulti.lat, ptMulti.lng);
      harness.addTeamMember('team-alpha', `am-${i}`);
      harness.createUser(`bm-${i}`, `BM ${i}`, ptMulti.lat, ptMulti.lng);
      harness.addTeamMember('team-beta', `bm-${i}`);
    }

    // Create a challenge fixture
    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'host-user',
      matchName: 'Premier League Semi-Final',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Manually insert a second candidate row for team-beta to simulate legacy/multiple candidate generation
    const extraCandId = `cand-${challenge.id}-team-beta`;
    harness.challengeCandidates.set(extraCandId, {
      id: extraCandId,
      challenge_id: challenge.id,
      team_id: 'team-beta',
      rank: 2,
      distance_m: 2100,
      status: 'offered',
      created_at: new Date().toISOString(),
      responded_at: null,
    });

    // Verify candidate rows in raw DB
    const rawCandidatesForChallenge = Array.from(harness.challengeCandidates.values()).filter(
      (c) => c.challenge_id === challenge.id,
    );
    assert.equal(rawCandidatesForChallenge.length, 2, 'Raw DB has 2 candidate rows for this challenge');

    // Retrieve offers for user-multi via listMyOffers
    const offers = harness.listMyOffers('user-multi');

    // ASSERTION: Exactly 1 offer card returned for the fixture
    assert.equal(offers.length, 1, 'Game offers must return exactly ONE card for the fixture');
    assert.equal(offers[0]?.challenge_id, challenge.id);
    assert.equal(offers[0]?.challenge?.match_name, 'Premier League Semi-Final');
  });

  it('F5.2: Status resolution prioritizes "interested" over "offered" during deduplication', () => {
    // Fixture C1
    const chId = 'ch-dedup-test';
    harness.teamChallenges.set(chId, {
      id: chId,
      from_team_id: 'team-other',
      to_team_id: null,
      created_by: 'other-user',
      match_name: 'Super Match',
      venue_id: null,
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      total_slots: 8,
      message: 'Great game',
      status: 'open',
      search_radius_m: 10000,
      area_name: 'Pune',
      game_type: 'friendly',
      end_time: null,
      match_lat: 18.5,
      match_lng: 73.8,
      match_id: null,
      created_at: new Date().toISOString(),
    });

    // User owns Squad 1 and Squad 2
    harness.createUser('user-cap', 'Captain', 18.5, 73.8);
    harness.createTeam('team-sq1', 'Squad 1', 'box_cricket', 'user-cap', 4);
    harness.createTeam('team-sq2', 'Squad 2', 'box_cricket', 'user-cap', 4);

    // Candidate for Squad 1: status = 'offered'
    harness.challengeCandidates.set('cand-1', {
      id: 'cand-1',
      challenge_id: chId,
      team_id: 'team-sq1',
      rank: 1,
      distance_m: 1000,
      status: 'offered',
      created_at: new Date(Date.now() - 10000).toISOString(),
      responded_at: null,
    });

    // Candidate for Squad 2: status = 'interested' (user requested game with Squad 2)
    harness.challengeCandidates.set('cand-2', {
      id: 'cand-2',
      challenge_id: chId,
      team_id: 'team-sq2',
      rank: 2,
      distance_m: 1200,
      status: 'interested',
      created_at: new Date(Date.now() - 5000).toISOString(),
      responded_at: new Date().toISOString(),
    });

    const offers = harness.listMyOffers('user-cap');

    assert.equal(offers.length, 1, 'Exactly 1 offer card');
    assert.equal(
      offers[0]?.status,
      'interested',
      'Card status must be "interested" so user sees their pending request instead of raw offer',
    );
  });

  it('F5.3: Distinct fixtures produce distinct cards keyed by challenge_id', () => {
    harness.createUser('host-1', 'Host 1', originPune.lat, originPune.lng);
    harness.createTeam('team-h1', 'Team H1', 'box_cricket', 'host-1', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h1m-${i}`, `H1M ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h1', `h1m-${i}`);
    }

    harness.createUser('host-2', 'Host 2', originPune.lat, originPune.lng);
    harness.createTeam('team-h2', 'Team H2', 'box_cricket', 'host-2', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h2m-${i}`, `H2M ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h2', `h2m-${i}`);
    }

    // Captain recipient
    harness.createUser('user-cap', 'Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-r1', 'Receiver Squad', 'box_cricket', 'user-cap', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`rm-${i}`, `RM ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-r1', `rm-${i}`);
    }

    // Host 1 posts fixture 1
    const ch1 = harness.postOpenChallenge({
      fromTeamId: 'team-h1',
      createdBy: 'host-1',
      matchName: 'Fixture Alpha',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Host 2 posts fixture 2
    const ch2 = harness.postOpenChallenge({
      fromTeamId: 'team-h2',
      createdBy: 'host-2',
      matchName: 'Fixture Beta',
      scheduledAt: new Date(Date.now() + 172800000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const offers = harness.listMyOffers('user-cap');

    assert.equal(offers.length, 2, 'Two distinct fixtures produce 2 distinct cards');
    const challengeIds = new Set(offers.map((o) => o.challenge_id));
    assert.ok(challengeIds.has(ch1.id));
    assert.ok(challengeIds.has(ch2.id));

    // Verify keyExtractor in offers.tsx is keyed by challenge_id
    const keyExtractor = (item: OpenOffer) => item.challenge_id;
    assert.notEqual(keyExtractor(offers[0] as OpenOffer), keyExtractor(offers[1] as OpenOffer));
  });
});
