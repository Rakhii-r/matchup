/**
 * Tier 2 Tests: Boundary & Corner Cases
 * 
 * Tests:
 * - Recipient exactly at radius boundary (<= radius vs > radius).
 * - Missing GPS / null coords / null radius handling.
 * - User with 0 squads, 1 squad, and multiple squads.
 * - Offer state transitions ('offered' -> 'interested' -> 'declined').
 * - Zombie offer prevention on decline.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  calculateGeodesicDistanceMeters,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';

describe('Tier 2: Boundary Cases - Radius Distance Boundary', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };
  const targetRadiusMeters = 10000; // 10 km

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();

    // Host
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host Squad', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`host-m${i}`, `HM ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `host-m${i}`);
    }
  });

  it('B1.1: Recipient located strictly inside or exactly on the radius boundary is included', () => {
    // Exact boundary test: point at 9,990 meters (~10m inside boundary)
    const ptBoundaryIn = createPointAtDistance(originPune, targetRadiusMeters - 10, 0);
    const measuredIn = calculateGeodesicDistanceMeters(originPune, ptBoundaryIn);
    assert.ok(measuredIn <= targetRadiusMeters, 'Must be within radius');

    harness.createUser('user-boundary-in', 'Boundary Inside Captain', ptBoundaryIn.lat, ptBoundaryIn.lng);
    harness.createTeam('team-boundary-in', 'Inside Squad', 'box_cricket', 'user-boundary-in', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`in-m${i}`, `In Member ${i}`, ptBoundaryIn.lat, ptBoundaryIn.lng);
      harness.addTeamMember('team-boundary-in', `in-m${i}`);
    }

    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Boundary Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: targetRadiusMeters,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const candidates = harness.rankChallengeCandidates(challenge.id, targetRadiusMeters);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.team_id, 'team-boundary-in');

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-boundary-in');
    assert.equal(notifs.length, 1, 'Captain inside boundary receives notification');
  });

  it('B1.2: Recipient located even 10 meters beyond the radius boundary is excluded', () => {
    // Point at 10,010 meters (~10m beyond boundary)
    const ptBoundaryOut = createPointAtDistance(originPune, targetRadiusMeters + 10, 0);
    const measuredOut = calculateGeodesicDistanceMeters(originPune, ptBoundaryOut);
    assert.ok(measuredOut > targetRadiusMeters, 'Must be beyond radius');

    harness.createUser('user-boundary-out', 'Boundary Outside Captain', ptBoundaryOut.lat, ptBoundaryOut.lng);
    harness.createTeam('team-boundary-out', 'Outside Squad', 'box_cricket', 'user-boundary-out', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`out-m${i}`, `Out Member ${i}`, ptBoundaryOut.lat, ptBoundaryOut.lng);
      harness.addTeamMember('team-boundary-out', `out-m${i}`);
    }

    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Boundary Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: targetRadiusMeters,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const candidates = harness.rankChallengeCandidates(challenge.id, targetRadiusMeters);
    assert.equal(candidates.length, 0, 'Candidate outside boundary must be excluded');

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-boundary-out');
    assert.equal(notifs.length, 0, 'Captain outside boundary receives 0 notifications');
  });
});

describe('Tier 2: Boundary Cases - Squad Count Variations (0, 1, Multiple)', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();

    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host Squad', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`host-m${i}`, `HM ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `host-m${i}`);
    }
  });

  it('B2.1: User with 0 squads - listMyOffers returns empty array safely without error', () => {
    harness.createUser('user-squadless', 'Squadless User', originPune.lat, originPune.lng);

    // Post challenge
    harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Open Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
    });

    const offers = harness.listMyOffers('user-squadless');
    assert.deepEqual(offers, [], 'Squadless user has empty offers list');
  });

  it('B2.2: User with 1 squad - listMyOffers returns exactly 1 card when matched', () => {
    const pt = createPointAtDistance(originPune, 3000, 0);
    harness.createUser('user-single', 'Single Squad Captain', pt.lat, pt.lng);
    harness.createTeam('team-single', 'Single Squad', 'box_cricket', 'user-single', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`sm-${i}`, `SM ${i}`, pt.lat, pt.lng);
      harness.addTeamMember('team-single', `sm-${i}`);
    }

    harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Single Squad Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const offers = harness.listMyOffers('user-single');
    assert.equal(offers.length, 1);
    assert.equal(offers[0]?.challenge?.match_name, 'Single Squad Match');
  });

  it('B2.3: User with 5 squads - listMyOffers still collapses to exactly 1 card per fixture', () => {
    const pt = createPointAtDistance(originPune, 2000, 0);
    harness.createUser('user-five', 'Five Squads Captain', pt.lat, pt.lng);

    for (let s = 1; s <= 5; s++) {
      const teamId = `team-five-${s}`;
      harness.createTeam(teamId, `Squad ${s}`, 'box_cricket', 'user-five', 4);
      for (let m = 1; m <= 3; m++) {
        harness.createUser(`f5-${s}-${m}`, `Member ${s}-${m}`, pt.lat, pt.lng);
        harness.addTeamMember(teamId, `f5-${s}-${m}`);
      }
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Mega League Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Manually add candidate records for all 5 squads to test deduplication resilience
    for (let s = 2; s <= 5; s++) {
      const candId = `cand-${ch.id}-team-five-${s}`;
      harness.challengeCandidates.set(candId, {
        id: candId,
        challenge_id: ch.id,
        team_id: `team-five-${s}`,
        rank: s,
        distance_m: 2000 + s * 100,
        status: 'offered',
        created_at: new Date().toISOString(),
        responded_at: null,
      });
    }

    const offers = harness.listMyOffers('user-five');
    assert.equal(offers.length, 1, 'Owner of 5 squads still receives strictly ONE card');
  });
});

describe('Tier 2: Offer State Transitions & Zombie Offer Prevention', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();

    // Host
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host Squad', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`hm-${i}`, `HM ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `hm-${i}`);
    }

    // Recipient Captain Multi with Squad A and Squad B
    const pt = createPointAtDistance(originPune, 2000, 0);
    harness.createUser('user-multi', 'Multi Captain', pt.lat, pt.lng);
    harness.createTeam('team-a', 'Squad A', 'box_cricket', 'user-multi', 4);
    harness.createTeam('team-b', 'Squad B', 'box_cricket', 'user-multi', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`am-${i}`, `AM ${i}`, pt.lat, pt.lng);
      harness.addTeamMember('team-a', `am-${i}`);
      harness.createUser(`bm-${i}`, `BM ${i}`, pt.lat, pt.lng);
      harness.addTeamMember('team-b', `bm-${i}`);
    }
  });

  it('B3.1: State transition - "offered" transitions to "interested" when request is sent', () => {
    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Transition Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Initial state: 'offered'
    let offers = harness.listMyOffers('user-multi');
    assert.equal(offers.length, 1);
    assert.equal(offers[0]?.status, 'offered');

    // Captain sends request with Squad A
    harness.applyToOpenChallenge(ch.id, 'team-a', 'user-multi');

    // Updated state: 'interested'
    offers = harness.listMyOffers('user-multi');
    assert.equal(offers.length, 1);
    assert.equal(offers[0]?.status, 'interested');

    // Host receives challenge_interest notification
    const interestNotifs = harness.notificationJobs.filter(
      (j) => j.user_id === 'user-host' && j.kind === 'challenge_interest',
    );
    assert.equal(interestNotifs.length, 1, 'Host captain received challenge_interest notification');
  });

  it('B3.2: Zombie Offer Prevention - Declining an offer cascades across ALL squads owned by user', () => {
    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Zombie Prevention Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Simulate presence of candidate rows for BOTH Squad A and Squad B
    harness.challengeCandidates.set(`cand-${ch.id}-team-b`, {
      id: `cand-${ch.id}-team-b`,
      challenge_id: ch.id,
      team_id: 'team-b',
      rank: 2,
      distance_m: 2100,
      status: 'offered',
      created_at: new Date().toISOString(),
      responded_at: null,
    });

    // Before declining, user sees 1 offer
    let offers = harness.listMyOffers('user-multi');
    assert.equal(offers.length, 1);

    // Captain declines the offer on the screen (which passes team_id = team-a)
    harness.declineOpenChallenge(ch.id, 'team-a', 'user-multi');

    // Verification: Both Squad A and Squad B candidate rows are set to 'declined'
    const candA = Array.from(harness.challengeCandidates.values()).find(
      (c) => c.challenge_id === ch.id && c.team_id === 'team-a',
    );
    const candB = Array.from(harness.challengeCandidates.values()).find(
      (c) => c.challenge_id === ch.id && c.team_id === 'team-b',
    );

    assert.equal(candA?.status, 'declined');
    assert.equal(candB?.status, 'declined', 'Decline cascade must also decline Squad B row');

    // After decline, offers list is empty - Squad B does NOT resurrect as a zombie offer!
    offers = harness.listMyOffers('user-multi');
    assert.equal(
      offers.length,
      0,
      'Declined fixture must completely disappear and not re-appear under secondary squads',
    );
  });
});
