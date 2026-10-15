/**
 * Challenger 1 Adversarial Stress Tests: Geospatial Boundaries & Deduplication Under Pressure
 * 
 * Focus Areas:
 * 1. Play-Zone Radius Boundaries:
 *    - Exact boundary (distance == radius) vs strictly outside (distance == radius + 1m).
 *    - Null squad coordinates / null profile locations: 0 notifications.
 * 2. Captain Deduplication Under Pressure:
 *    - Captains with 2, 5, and 10 squads all within radius.
 *    - Verification of rank_challenge_candidates (single closest squad).
 *    - Verification of post_open_challenge (strictly single notification).
 *    - Verification of listMyOffers() and UI deduplication (strictly 1 card).
 * 3. Decline & Zombie Offer Prevention:
 *    - Decline cascades across all squads owned by the captain.
 *    - Multi-squad zombie resurrection prevention.
 * 4. Multi-Fixture Concurrency:
 *    - Independent deduplication and decline isolation across concurrent fixtures.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  calculateGeodesicDistanceMeters,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';
import type { OpenOffer } from '@features/teams/domain/challengeSchema';

describe('Challenger 1 Adversarial Suite: Play-Zone Radius Boundaries', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };
  const radiusM = 25000; // 25 km standard play-zone radius

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

  it('Boundary 1: Recipient exactly at radius boundary (distance == radius) is INCLUDED', () => {
    // Generate point exactly at 25,000 meters
    const ptExact = createPointAtDistance(originPune, radiusM, 0);
    const measuredDist = calculateGeodesicDistanceMeters(originPune, ptExact);
    // Floating-point geodesic math tolerance <= 0.5m
    assert.ok(
      Math.abs(measuredDist - radiusM) < 1.0,
      `Calculated point should be at ${radiusM}m, got ${measuredDist}`,
    );

    harness.createUser('user-exact', 'Exact Boundary Captain', ptExact.lat, ptExact.lng);
    harness.createTeam('team-exact', 'Exact Squad', 'box_cricket', 'user-exact', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`exact-m${i}`, `Exact Member ${i}`, ptExact.lat, ptExact.lng);
      harness.addTeamMember('team-exact', `exact-m${i}`);
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Exact Boundary Clash',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const candidates = harness.rankChallengeCandidates(ch.id, radiusM);
    assert.equal(candidates.length, 1, 'Candidate exactly on boundary must be included');
    assert.equal(candidates[0]?.team_id, 'team-exact');

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-exact');
    assert.equal(notifs.length, 1, 'Notification enqueued for boundary candidate');
  });

  it('Boundary 2: Recipient strictly outside (distance == radius + 1m) is EXCLUDED', () => {
    // Generate point at radius + 1 meter (25,001 meters)
    const ptOutside = createPointAtDistance(originPune, radiusM + 1, 0);
    const measuredDist = calculateGeodesicDistanceMeters(originPune, ptOutside);
    assert.ok(measuredDist > radiusM, 'Must be strictly greater than radius');

    harness.createUser('user-out1m', 'Out 1m Captain', ptOutside.lat, ptOutside.lng);
    harness.createTeam('team-out1m', 'Out 1m Squad', 'box_cricket', 'user-out1m', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`out-m${i}`, `Out Member ${i}`, ptOutside.lat, ptOutside.lng);
      harness.addTeamMember('team-out1m', `out-m${i}`);
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Outside Boundary Clash',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const candidates = harness.rankChallengeCandidates(ch.id, radiusM);
    assert.equal(candidates.length, 0, 'Candidate at radius + 1m must be strictly excluded');

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-out1m');
    assert.equal(notifs.length, 0, 'Zero notifications for candidate at radius + 1m');
  });

  it('Boundary 3: Null squad coordinates and null profile locations produce 0 candidates and 0 notifications', () => {
    // Candidate captain and members have all null coordinates
    harness.createUser('user-null-loc', 'Ghost Captain', null, null);
    harness.createTeam('team-null-loc', 'Ghost Squad', 'box_cricket', 'user-null-loc', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`ghost-m${i}`, `Ghost Member ${i}`, null, null);
      harness.addTeamMember('team-null-loc', `ghost-m${i}`);
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Ghost Location Test',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const candidates = harness.rankChallengeCandidates(ch.id, radiusM);
    assert.equal(candidates.length, 0, 'Squad with null location centroid must return 0 candidates');

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-null-loc');
    assert.equal(notifs.length, 0, 'Squad with null location must receive 0 notifications');
  });

  it('Boundary 4: Host with null coordinates falls back gracefully or returns 0 candidates when all 4 layers null', () => {
    // Host has null profile coords, team members have null coords, no venue, no match coords
    harness.createUser('user-null-host', 'Null Host Captain', null, null);
    harness.createTeam('team-null-host', 'Null Host Squad', 'box_cricket', 'user-null-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`nhm-${i}`, `NH Member ${i}`, null, null);
      harness.addTeamMember('team-null-host', `nhm-${i}`);
    }

    // Nearby valid recipient
    const ptNear = createPointAtDistance(originPune, 3000, 0);
    harness.createUser('user-near', 'Near Captain', ptNear.lat, ptNear.lng);
    harness.createTeam('team-near', 'Near Squad', 'box_cricket', 'user-near', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`nm-${i}`, `N Member ${i}`, ptNear.lat, ptNear.lng);
      harness.addTeamMember('team-near', `nm-${i}`);
    }

    // Post challenge without match_lat/match_lng and without venue
    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-null-host',
      createdBy: 'user-null-host',
      matchName: 'Totally Unlocated Fixture',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM,
      lat: null,
      lng: null,
    });

    // When origin_location cannot be determined across all 4 fallback layers, 0 candidates qualify
    const candidates = harness.rankChallengeCandidates(ch.id, radiusM);
    assert.equal(candidates.length, 0, 'Unresolvable origin location safely produces 0 candidates without crash');

    const notifs = harness.notificationJobs.filter((j) => j.data.challenge_id === ch.id);
    assert.equal(notifs.length, 0, 'Zero notifications when origin location is null');
  });
});

describe('Challenger 1 Adversarial Suite: Captain Deduplication Under Pressure (2, 5, 10 Squads)', () => {
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
  });

  it('Pressure 1: Captain with 2 squads returns strictly 1 candidate row, 1 notification, and 1 offer card', () => {
    const pt1 = createPointAtDistance(originPune, 1000, 0);
    const pt2 = createPointAtDistance(originPune, 2000, 45);

    harness.createUser('cap-2', 'Captain TwoSquads', pt1.lat, pt1.lng);
    harness.createTeam('team-2-close', 'TwoSquads Alpha (1km)', 'box_cricket', 'cap-2', 4);
    harness.createTeam('team-2-far', 'TwoSquads Beta (2km)', 'box_cricket', 'cap-2', 4);

    for (let i = 1; i <= 3; i++) {
      harness.createUser(`m2a-${i}`, `M2A ${i}`, pt1.lat, pt1.lng);
      harness.addTeamMember('team-2-close', `m2a-${i}`);
      harness.createUser(`m2b-${i}`, `M2B ${i}`, pt2.lat, pt2.lng);
      harness.addTeamMember('team-2-far', `m2b-${i}`);
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Two Squad Pressure Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // 1. rank_challenge_candidates must return only the closest team
    const candidates = harness.rankChallengeCandidates(ch.id, 25000);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.team_id, 'team-2-close', 'Picked closest squad (1km)');

    // 2. post_open_challenge enqueued strictly 1 notification
    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'cap-2');
    assert.equal(notifs.length, 1, 'Strictly 1 push notification for 2-squad captain');

    // 3. listMyOffers returns strictly 1 card
    const offers = harness.listMyOffers('cap-2');
    assert.equal(offers.length, 1, 'Strictly 1 card displayed in Game Offers');
  });

  it('Pressure 2: Captain with 5 squads returns strictly 1 candidate row, 1 notification, and 1 offer card', () => {
    harness.createUser('cap-5', 'Captain FiveSquads', originPune.lat, originPune.lng);

    for (let s = 1; s <= 5; s++) {
      const pt = createPointAtDistance(originPune, s * 1000, s * 40);
      const teamId = `team-5-sq-${s}`;
      harness.createTeam(teamId, `Squad 5-${s} (${s}km)`, 'box_cricket', 'cap-5', 4);
      for (let m = 1; m <= 3; m++) {
        harness.createUser(`m5-${s}-${m}`, `M5-${s}-${m}`, pt.lat, pt.lng);
        harness.addTeamMember(teamId, `m5-${s}-${m}`);
      }
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Five Squad Pressure Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // 1. rank_challenge_candidates picks closest (Squad 1 at 1km)
    const candidates = harness.rankChallengeCandidates(ch.id, 25000);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.team_id, 'team-5-sq-1', 'Picked closest squad 1');

    // 2. strictly 1 notification
    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'cap-5');
    assert.equal(notifs.length, 1, 'Strictly 1 push notification for 5-squad captain');

    // 3. strictly 1 offer card
    const offers = harness.listMyOffers('cap-5');
    assert.equal(offers.length, 1, 'Strictly 1 card for 5-squad captain');
  });

  it('Pressure 3: Captain with 10 squads under heavy pressure returns strictly 1 candidate row, 1 notification, and 1 offer card', () => {
    harness.createUser('cap-10', 'Captain TenSquads', originPune.lat, originPune.lng);

    for (let s = 1; s <= 10; s++) {
      const dist = 500 + s * 300; // 800m to 3500m
      const pt = createPointAtDistance(originPune, dist, s * 30);
      const teamId = `team-10-sq-${s}`;
      harness.createTeam(teamId, `Squad 10-${s} (${dist}m)`, 'box_cricket', 'cap-10', 4);
      for (let m = 1; m <= 3; m++) {
        harness.createUser(`m10-${s}-${m}`, `M10-${s}-${m}`, pt.lat, pt.lng);
        harness.addTeamMember(teamId, `m10-${s}-${m}`);
      }
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Ten Squad Pressure Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // 1. rank_challenge_candidates picks closest (Squad 1 at 800m)
    const candidates = harness.rankChallengeCandidates(ch.id, 25000);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.team_id, 'team-10-sq-1', 'Picked closest squad 1 (800m)');

    // 2. strictly 1 notification
    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'cap-10');
    assert.equal(notifs.length, 1, 'Strictly 1 push notification despite 10 squads');

    // 3. Even if database had candidate rows for ALL 10 squads, listMyOffers returns strictly 1 card
    for (let s = 2; s <= 10; s++) {
      const candId = `cand-${ch.id}-team-10-sq-${s}`;
      harness.challengeCandidates.set(candId, {
        id: candId,
        challenge_id: ch.id,
        team_id: `team-10-sq-${s}`,
        rank: s,
        distance_m: 500 + s * 300,
        status: 'offered',
        created_at: new Date().toISOString(),
        responded_at: null,
      });
    }

    assert.equal(
      Array.from(harness.challengeCandidates.values()).filter((c) => c.challenge_id === ch.id).length,
      10,
      'Raw DB has 10 candidate rows',
    );

    const offers = harness.listMyOffers('cap-10');
    assert.equal(offers.length, 1, 'listMyOffers collapses 10 candidate rows to strictly 1 card');
    assert.equal(offers[0]?.challenge_id, ch.id);
  });
});

describe('Challenger 1 Adversarial Suite: Decline Cascades & Zombie Offer Eradication', () => {
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
  });

  it('Zombie Prevention: Declining an offer cascades across all 10 squads owned by the captain', () => {
    // Captain with 10 squads
    harness.createUser('cap-zombie', 'Captain MultiZombie', originPune.lat, originPune.lng);
    for (let s = 1; s <= 10; s++) {
      const teamId = `team-z-${s}`;
      harness.createTeam(teamId, `Zombie Squad ${s}`, 'box_cricket', 'cap-zombie', 4);
      for (let m = 1; m <= 3; m++) {
        harness.createUser(`zm-${s}-${m}`, `ZM ${s}-${m}`, originPune.lat, originPune.lng);
        harness.addTeamMember(teamId, `zm-${s}-${m}`);
      }
    }

    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Zombie Eradication Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Populate candidate rows across all 10 squads
    for (let s = 2; s <= 10; s++) {
      const candId = `cand-${ch.id}-team-z-${s}`;
      harness.challengeCandidates.set(candId, {
        id: candId,
        challenge_id: ch.id,
        team_id: `team-z-${s}`,
        rank: s,
        distance_m: 1000 + s * 100,
        status: 'offered',
        created_at: new Date().toISOString(),
        responded_at: null,
      });
    }

    // Captain sees 1 offer card
    let offers = harness.listMyOffers('cap-zombie');
    assert.equal(offers.length, 1);

    // Captain declines the offer on the card (passing team-z-1)
    harness.declineOpenChallenge(ch.id, 'team-z-1', 'cap-zombie');

    // Verify ALL 10 candidate rows are now 'declined'
    for (let s = 1; s <= 10; s++) {
      const cand = Array.from(harness.challengeCandidates.values()).find(
        (c) => c.challenge_id === ch.id && c.team_id === `team-z-${s}`,
      );
      assert.equal(
        cand?.status,
        'declined',
        `Squad ${s} candidate row must be transitioned to declined`,
      );
    }

    // Verify listMyOffers immediately returns 0 cards (no zombie resurrection)
    offers = harness.listMyOffers('cap-zombie');
    assert.equal(
      offers.length,
      0,
      'Declined challenge must NOT resurrect under any of the captain other 9 squads',
    );
  });

  it('Multi-Fixture Concurrency: Declining Fixture A does not impact Fixture B or Fixture C', () => {
    // 3 different hosts post 3 fixtures
    harness.createUser('host-1', 'Host 1', originPune.lat, originPune.lng);
    harness.createTeam('team-h1', 'Squad H1', 'box_cricket', 'host-1', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h1m-${i}`, `H1M ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h1', `h1m-${i}`);
    }

    harness.createUser('host-2', 'Host 2', originPune.lat, originPune.lng);
    harness.createTeam('team-h2', 'Squad H2', 'box_cricket', 'host-2', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h2m-${i}`, `H2M ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h2', `h2m-${i}`);
    }

    harness.createUser('host-3', 'Host 3', originPune.lat, originPune.lng);
    harness.createTeam('team-h3', 'Squad H3', 'box_cricket', 'host-3', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h3m-${i}`, `H3M ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h3', `h3m-${i}`);
    }

    // Captain with 3 squads
    harness.createUser('cap-conc', 'Concurrent Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-c1', 'Squad C1', 'box_cricket', 'cap-conc', 4);
    harness.createTeam('team-c2', 'Squad C2', 'box_cricket', 'cap-conc', 4);
    harness.createTeam('team-c3', 'Squad C3', 'box_cricket', 'cap-conc', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`cm1-${i}`, `CM1 ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-c1', `cm1-${i}`);
      harness.createUser(`cm2-${i}`, `CM2 ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-c2', `cm2-${i}`);
      harness.createUser(`cm3-${i}`, `CM3 ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-c3', `cm3-${i}`);
    }

    const ch1 = harness.postOpenChallenge({
      fromTeamId: 'team-h1',
      createdBy: 'host-1',
      matchName: 'Fixture Alpha',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const ch2 = harness.postOpenChallenge({
      fromTeamId: 'team-h2',
      createdBy: 'host-2',
      matchName: 'Fixture Beta',
      scheduledAt: new Date(Date.now() + 172800000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const ch3 = harness.postOpenChallenge({
      fromTeamId: 'team-h3',
      createdBy: 'host-3',
      matchName: 'Fixture Gamma',
      scheduledAt: new Date(Date.now() + 259200000).toISOString(),
      totalSlots: 8,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // Captain has 3 offers
    let offers = harness.listMyOffers('cap-conc');
    assert.equal(offers.length, 3, 'Captain has 3 distinct offer cards for 3 fixtures');

    // Decline Fixture Alpha
    harness.declineOpenChallenge(ch1.id, 'team-c1', 'cap-conc');

    // Verify Fixture Alpha is gone, but Fixtures Beta and Gamma remain intact
    offers = harness.listMyOffers('cap-conc');
    assert.equal(offers.length, 2, 'Two offer cards remain after declining Fixture Alpha');
    const remainingChIds = offers.map((o) => o.challenge_id);
    assert.ok(!remainingChIds.includes(ch1.id), 'Fixture Alpha is removed');
    assert.ok(remainingChIds.includes(ch2.id), 'Fixture Beta remains');
    assert.ok(remainingChIds.includes(ch3.id), 'Fixture Gamma remains');
  });
});
