/**
 * Tier 1 Tests: Feature Coverage - Global In-App Match & Fixture Discovery
 * 
 * Tests:
 * - F3: Global match discovery with null coords / without distance gate.
 * - F4: Global open challenges browsing for squad-less users.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';

describe('Tier 1: F3 - Global match discovery with null coords / without distance gate', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();

    // Populate matches across different cities and scheduled times
    const now = Date.now();

    // Match 1: Pune (local) - Scheduled +2 days
    harness.matches.set('match-pune', {
      id: 'match-pune',
      creator_id: 'creator-1',
      sport: 'box_cricket',
      venue_id: 'venue-1',
      venue_text: 'Pune Arena',
      area_name: 'Kothrud, Pune',
      scheduled_at: new Date(now + 2 * 86400000).toISOString(),
      end_time: null,
      total_slots: 10,
      filled_slots: 2,
      missing_count: 8,
      share_code: 'PUNE01',
      lat: 18.5204,
      lng: 73.8567,
      match_lat: 18.5204,
      match_lng: 73.8567,
      match_name: 'Pune Cricket League',
      status: 'open',
      match_type: 'open',
      search_radius_m: 5000,
      challenge_id: null,
    });

    // Match 2: Mumbai (~120 km away) - Scheduled +1 day (earliest)
    harness.matches.set('match-mumbai', {
      id: 'match-mumbai',
      creator_id: 'creator-2',
      sport: 'box_cricket',
      venue_id: 'venue-2',
      venue_text: 'Wankhede Turf',
      area_name: 'Mumbai',
      scheduled_at: new Date(now + 1 * 86400000).toISOString(),
      end_time: null,
      total_slots: 12,
      filled_slots: 4,
      missing_count: 8,
      share_code: 'MUM001',
      lat: 18.9388,
      lng: 72.8258,
      match_lat: 18.9388,
      match_lng: 72.8258,
      match_name: 'Mumbai Open Match',
      status: 'open',
      match_type: 'open',
      search_radius_m: 5000,
      challenge_id: null,
    });

    // Match 3: Bangalore (~840 km away) - Scheduled +3 days
    harness.matches.set('match-bangalore', {
      id: 'match-bangalore',
      creator_id: 'creator-3',
      sport: 'box_cricket',
      venue_id: 'venue-3',
      venue_text: 'Koramangala Turf',
      area_name: 'Bangalore',
      scheduled_at: new Date(now + 3 * 86400000).toISOString(),
      end_time: null,
      total_slots: 10,
      filled_slots: 1,
      missing_count: 9,
      share_code: 'BLR001',
      lat: 12.9352,
      lng: 77.6245,
      match_lat: 12.9352,
      match_lng: 77.6245,
      match_name: 'Bangalore Smashers',
      status: 'open',
      match_type: 'open',
      search_radius_m: 2000,
      challenge_id: null,
    });

    // Match 4: Completed match (should never appear in discovery)
    harness.matches.set('match-completed', {
      id: 'match-completed',
      creator_id: 'creator-1',
      sport: 'box_cricket',
      venue_id: null,
      venue_text: 'Old Turf',
      area_name: 'Pune',
      scheduled_at: new Date(now - 86400000).toISOString(),
      end_time: null,
      total_slots: 10,
      filled_slots: 10,
      missing_count: 0,
      share_code: 'OLD001',
      lat: 18.5204,
      lng: 73.8567,
      match_lat: 18.5204,
      match_lng: 73.8567,
      match_name: 'Yesterday Completed Match',
      status: 'completed',
      match_type: 'open',
      search_radius_m: 5000,
      challenge_id: null,
    });
  });

  it('F3.1: When GPS coords or radius are null, nearby_matches returns ALL open matches globally', () => {
    // Viewer has no GPS coordinates (null lat, null lng)
    const results = harness.nearbyMatches({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
    });

    assert.equal(results.length, 3, 'All 3 open matches across Pune, Mumbai, Bangalore returned');

    // Chronological order (scheduled_at asc)
    assert.equal(results[0]?.id, 'match-mumbai', 'Earliest (+1 day) comes first');
    assert.equal(results[1]?.id, 'match-pune', 'Second (+2 days) comes second');
    assert.equal(results[2]?.id, 'match-bangalore', 'Third (+3 days) comes third');
  });

  it('F3.2: Creator search_radius_m does NOT block global in-app viewing', () => {
    // Match in Bangalore has creator search_radius_m = 2000 (2km).
    // A viewer browsing globally (radiusM: null) must still see and view the match.
    const results = harness.nearbyMatches({
      lat: null,
      lng: null,
      radiusM: null,
      sport: null,
    });

    const bangaloreMatch = results.find((m) => m.id === 'match-bangalore');
    assert.ok(bangaloreMatch, 'Match with tight creator search_radius_m is discoverable globally');
  });

  it('F3.3: When coordinates and radius are explicitly specified, filters by ST_DWithin and orders by distance', () => {
    // Viewer is in Pune with a 10 km radius filter
    const results = harness.nearbyMatches({
      lat: originPune.lat,
      lng: originPune.lng,
      radiusM: 10000, // 10 km
      sport: 'box_cricket',
    });

    assert.equal(results.length, 1, 'Only Pune match is within 10 km');
    assert.equal(results[0]?.id, 'match-pune');
  });
});

describe('Tier 1: F4 - Global open challenges browsing for squad-less users', () => {
  let harness: MatchupDatabaseHarness;
  const originPune: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();

    // Host 1: 4v4 Cricket team in Pune
    harness.createUser('user-host-1', 'Host 1', originPune.lat, originPune.lng);
    harness.createTeam('team-h1', 'Deccan Royals', 'box_cricket', 'user-host-1', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`h1-m${i}`, `H1 M${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h1', `h1-m${i}`);
    }

    // Host 2: 6v6 Cricket team in Pune
    harness.createUser('user-host-2', 'Host 2', originPune.lat, originPune.lng);
    harness.createTeam('team-h2', 'Shivaji Strikers', 'box_cricket', 'user-host-2', 6);
    for (let i = 1; i <= 5; i++) {
      harness.createUser(`h2-m${i}`, `H2 M${i}`, originPune.lat, originPune.lng);
      harness.addTeamMember('team-h2', `h2-m${i}`);
    }

    // Post open challenges for both
    harness.postOpenChallenge({
      fromTeamId: 'team-h1',
      createdBy: 'user-host-1',
      matchName: '4v4 Royal Battle',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8, // 4v4
      lat: originPune.lat,
      lng: originPune.lng,
    });

    harness.postOpenChallenge({
      fromTeamId: 'team-h2',
      createdBy: 'user-host-2',
      matchName: '6v6 Super Six',
      scheduledAt: new Date(Date.now() + 172800000).toISOString(),
      totalSlots: 12, // 6v6
      lat: originPune.lat,
      lng: originPune.lng,
    });
  });

  it('F4.1: Squad-less user (in_team_size: null) can browse open challenges across all formats', () => {
    // Squad-less user has no declared format (teamSize: null) and no GPS coords (lat: null, lng: null)
    const results = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: null,
      callerUserId: 'squadless-user-1',
    });

    assert.equal(results.length, 2, 'Squad-less user sees all open challenges without format restriction');
    const names = results.map((r) => r.match_name);
    assert.ok(names.includes('4v4 Royal Battle'));
    assert.ok(names.includes('6v6 Super Six'));
  });

  it('F4.2: Host team members are excluded from browsing their own open challenge', () => {
    // Caller is a member of team-h1
    const results = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: null,
      callerUserId: 'user-host-1',
    });

    assert.equal(results.length, 1, 'Self-posted challenge is excluded');
    assert.equal(results[0]?.match_name, '6v6 Super Six');
  });

  it('F4.3: When teamSize is specified, filters strictly to that format', () => {
    const results4v4 = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: 4,
      callerUserId: 'other-user',
    });

    assert.equal(results4v4.length, 1);
    assert.equal(results4v4[0]?.match_name, '4v4 Royal Battle');

    const results6v6 = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: 6,
      callerUserId: 'other-user',
    });

    assert.equal(results6v6.length, 1);
    assert.equal(results6v6[0]?.match_name, '6v6 Super Six');
  });
});
