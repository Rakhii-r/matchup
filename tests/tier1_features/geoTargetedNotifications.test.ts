/**
 * Tier 1 Tests: Feature Coverage - Geo-Targeted Notifications & Deduplication
 * 
 * Tests:
 * - F1: Geo-targeted notification radius filtering (ST_DWithin).
 * - F2: Single notification per captain owning multiple squads.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';

describe('Tier 1: F1 - Geo-targeted notification radius filtering (ST_DWithin)', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();
  });

  it('F1.1: Captain within play-zone radius receives challenge_offer notification', () => {
    // Host in Pune
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host FC', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-host-m${i}`, `Host Member ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `user-host-m${i}`);
    }

    // Nearby Captain 5 km away
    const point5km = createPointAtDistance(originPune, 5000, 45);
    harness.createUser('user-nearby', 'Nearby Captain', point5km.lat, point5km.lng);
    harness.createTeam('team-nearby', 'Nearby FC', 'box_cricket', 'user-nearby', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-nearby-m${i}`, `Nearby Member ${i}`, point5km.lat, point5km.lng);
      harness.addTeamMember('team-nearby', `user-nearby-m${i}`);
    }

    // Distant Captain 35 km away
    const point35km = createPointAtDistance(originPune, 35000, 90);
    harness.createUser('user-distant', 'Distant Captain', point35km.lat, point35km.lng);
    harness.createTeam('team-distant', 'Distant FC', 'box_cricket', 'user-distant', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-distant-m${i}`, `Distant Member ${i}`, point35km.lat, point35km.lng);
      harness.addTeamMember('team-distant', `user-distant-m${i}`);
    }

    // Post open challenge with 10 km search radius
    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Saturday 4v4 Clash',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8, // 4v4 format
      radiusM: 10000, // 10 km
      lat: originPune.lat,
      lng: originPune.lng,
    });

    assert.equal(challenge.status, 'open');

    // Verify candidates in challenge_candidates
    const candidates = Array.from(harness.challengeCandidates.values()).filter(
      (c) => c.challenge_id === challenge.id,
    );
    assert.equal(candidates.length, 1, 'Only 1 candidate inside 10km radius should qualify');
    assert.equal(candidates[0]?.team_id, 'team-nearby');

    // Verify notification_jobs
    const notifications = harness.notificationJobs.filter(
      (j) => j.data.challenge_id === challenge.id,
    );
    assert.equal(notifications.length, 1, 'Strictly 1 notification job enqueued');
    assert.equal(notifications[0]?.user_id, 'user-nearby', 'Targeted nearby captain');
    assert.equal(notifications[0]?.kind, 'challenge_offer');

    // Verify distant captain received 0 notifications
    const distantNotifs = harness.notificationJobs.filter((j) => j.user_id === 'user-distant');
    assert.equal(distantNotifs.length, 0, 'Distant captain outside radius receives 0 notifications');
  });

  it('F1.2: Squads with null member locations are excluded from candidate ranking and notifications', () => {
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host FC', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-host-m${i}`, `Host Member ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `user-host-m${i}`);
    }

    // Captain with no coordinates registered (null lat/lng)
    harness.createUser('user-nolocation', 'No Location Captain', null, null);
    harness.createTeam('team-nolocation', 'Roaming FC', 'box_cricket', 'user-nolocation', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-nolocation-m${i}`, `Member ${i}`, null, null);
      harness.addTeamMember('team-nolocation', `user-nolocation-m${i}`);
    }

    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Weekend Match',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 25000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const notifs = harness.notificationJobs.filter((j) => j.user_id === 'user-nolocation');
    assert.equal(notifs.length, 0, 'Squad with null location centroid must receive no geo-targeted notification');
  });
});

describe('Tier 1: F2 - Notification captain deduplication across multiple squads', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();
  });

  it('F2.1: Captain owning multiple eligible squads receives at most ONE push notification per fixture', () => {
    // Host Team
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host XI', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-host-m${i}`, `Host Member ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `user-host-m${i}`);
    }

    // Captain Multi owns 3 squads at varying locations within radius:
    // Squad 1 at 2 km
    // Squad 2 at 4 km
    // Squad 3 at 7 km
    const point2km = createPointAtDistance(originPune, 2000, 0);
    const point4km = createPointAtDistance(originPune, 4000, 90);
    const point7km = createPointAtDistance(originPune, 7000, 180);

    harness.createUser('user-multi', 'Multi-Squad Captain', point2km.lat, point2km.lng);

    // Squad 1
    harness.createTeam('team-multi-1', 'Multi Titans', 'box_cricket', 'user-multi', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`m1-${i}`, `Squad1 Member ${i}`, point2km.lat, point2km.lng);
      harness.addTeamMember('team-multi-1', `m1-${i}`);
    }

    // Squad 2
    harness.createTeam('team-multi-2', 'Multi Warriors', 'box_cricket', 'user-multi', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`m2-${i}`, `Squad2 Member ${i}`, point4km.lat, point4km.lng);
      harness.addTeamMember('team-multi-2', `m2-${i}`);
    }

    // Squad 3
    harness.createTeam('team-multi-3', 'Multi Knights', 'box_cricket', 'user-multi', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`m3-${i}`, `Squad3 Member ${i}`, point7km.lat, point7km.lng);
      harness.addTeamMember('team-multi-3', `m3-${i}`);
    }

    // Post open challenge with 15 km radius (encompassing all 3 squads)
    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'Pune Box Derby',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 15000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    // 1. Check candidate ranking: DISTINCT ON (t.owner_id) must pick ONLY the closest squad (team-multi-1)
    const candidates = harness.rankChallengeCandidates(challenge.id, 15000, 5);
    assert.equal(candidates.length, 1, 'DISTINCT ON (t.owner_id) must return exactly 1 candidate team for user-multi');
    assert.equal(candidates[0]?.team_id, 'team-multi-1', 'Closest team (2km) was selected');

    // 2. Check push notifications in notification_jobs
    const userNotifications = harness.notificationJobs.filter(
      (j) => j.user_id === 'user-multi' && j.data.challenge_id === challenge.id,
    );

    assert.equal(
      userNotifications.length,
      1,
      'Captain owning multiple squads must receive strictly ONE challenge_offer notification',
    );
    assert.equal(userNotifications[0]?.kind, 'challenge_offer');
    assert.equal(userNotifications[0]?.data.route, '/teams/offers');
  });

  it('F2.2: Different captains owning squads within radius all receive their own single notification', () => {
    harness.createUser('user-host', 'Host Captain', originPune.lat, originPune.lng);
    harness.createTeam('team-host', 'Host XI', 'box_cricket', 'user-host', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-host-m${i}`, `Host Member ${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-host', `user-host-m${i}`);
    }

    // Captain A with 2 squads
    const ptA = createPointAtDistance(originPune, 3000, 0);
    harness.createUser('user-cap-a', 'Captain A', ptA.lat, ptA.lng);
    harness.createTeam('team-a1', 'Alpha 1', 'box_cricket', 'user-cap-a', 4);
    harness.createTeam('team-a2', 'Alpha 2', 'box_cricket', 'user-cap-a', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-a1-m${i}`, `A1 Member ${i}`, ptA.lat, ptA.lng);
      harness.addTeamMember('team-a1', `user-a1-m${i}`);
      harness.createUser(`user-a2-m${i}`, `A2 Member ${i}`, ptA.lat, ptA.lng);
      harness.addTeamMember('team-a2', `user-a2-m${i}`);
    }

    // Captain B with 1 squad
    const ptB = createPointAtDistance(originPune, 4000, 120);
    harness.createUser('user-cap-b', 'Captain B', ptB.lat, ptB.lng);
    harness.createTeam('team-b1', 'Bravo 1', 'box_cricket', 'user-cap-b', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`user-b1-m${i}`, `B1 Member ${i}`, ptB.lat, ptB.lng);
      harness.addTeamMember('team-b1', `user-b1-m${i}`);
    }

    const challenge = harness.postOpenChallenge({
      fromTeamId: 'team-host',
      createdBy: 'user-host',
      matchName: 'City Tournament',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 10000,
      lat: originPune.lat,
      lng: originPune.lng,
    });

    const notifsA = harness.notificationJobs.filter((j) => j.user_id === 'user-cap-a');
    const notifsB = harness.notificationJobs.filter((j) => j.user_id === 'user-cap-b');

    assert.equal(notifsA.length, 1, 'Captain A receives exactly 1 notification');
    assert.equal(notifsB.length, 1, 'Captain B receives exactly 1 notification');
  });
});
