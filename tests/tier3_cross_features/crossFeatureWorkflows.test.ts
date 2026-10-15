/**
 * Tier 3 Tests: Cross-Feature Combinations & Multi-System Interaction
 * 
 * Tests:
 * - Flow 1: Host creates challenge -> geo-targeting checks -> in-radius multi-squad recipient views single card
 *           -> sends game request -> host receives challenge_interest notification.
 * - Flow 2: Host posts fixture with tight notification radius (e.g. 5km) -> out-of-radius player (>50km)
 *           browses Games feed globally without radius restriction while notification was strictly localized.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';

describe('Tier 3: Cross-Feature Combinations', () => {
  let harness: MatchupDatabaseHarness;
  const puneCenter: TestGeoPoint = { lat: 18.5204, lng: 73.8567 };

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();
  });

  it('Flow 1: End-to-end challenge creation -> geo-targeting -> single offer card -> apply -> host interest notification', () => {
    // 1. Setup Host Captain & Squad
    harness.createUser('host-id', 'Vikram Host', puneCenter.lat, puneCenter.lng);
    harness.createTeam('host-squad', 'Pune Panthers', 'box_cricket', 'host-id', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`hm-${i}`, `Panther ${i}`, puneCenter.lat, puneCenter.lng);
      harness.addTeamMember('host-squad', `hm-${i}`);
    }

    // 2. Setup Opponent Captain Rahul who owns 2 squads within 5km
    const ptRahul = createPointAtDistance(puneCenter, 3000, 45);
    harness.createUser('opp-rahul', 'Rahul Captain', ptRahul.lat, ptRahul.lng);

    harness.createTeam('rahul-squad-1', 'Rahul Tigers', 'box_cricket', 'opp-rahul', 4);
    harness.createTeam('rahul-squad-2', 'Rahul Lions', 'box_cricket', 'opp-rahul', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`rm1-${i}`, `Tiger ${i}`, ptRahul.lat, ptRahul.lng);
      harness.addTeamMember('rahul-squad-1', `rm1-${i}`);
      harness.createUser(`rm2-${i}`, `Lion ${i}`, ptRahul.lat, ptRahul.lng);
      harness.addTeamMember('rahul-squad-2', `rm2-${i}`);
    }

    // 3. Setup Distant Captain Rohit at 30km
    const ptRohit = createPointAtDistance(puneCenter, 30000, 90);
    harness.createUser('opp-rohit', 'Rohit Captain', ptRohit.lat, ptRohit.lng);
    harness.createTeam('rohit-squad', 'Rohit Hawks', 'box_cricket', 'opp-rohit', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`rhm-${i}`, `Hawk ${i}`, ptRohit.lat, ptRohit.lng);
      harness.addTeamMember('rohit-squad', `rhm-${i}`);
    }

    // Step A: Host posts open challenge with 10 km play-zone radius
    const challenge = harness.postOpenChallenge({
      fromTeamId: 'host-squad',
      createdBy: 'host-id',
      matchName: 'Quarter-Final Clash',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 10000,
      lat: puneCenter.lat,
      lng: puneCenter.lng,
    });

    // Step B: Verify Push Notification geo-targeting and deduplication
    // Rahul (at 3km) must receive exactly 1 push notification
    const rahulNotifs = harness.notificationJobs.filter(
      (j) => j.user_id === 'opp-rahul' && j.data.challenge_id === challenge.id,
    );
    assert.equal(rahulNotifs.length, 1, 'Rahul receives strictly 1 notification despite owning 2 squads');
    assert.equal(rahulNotifs[0]?.kind, 'challenge_offer');

    // Rohit (at 30km) receives 0 push notifications
    const rohitNotifs = harness.notificationJobs.filter((j) => j.user_id === 'opp-rohit');
    assert.equal(rohitNotifs.length, 0, 'Rohit outside radius receives 0 push notifications');

    // Step C: Rahul opens "Game Offers" screen (/teams/offers)
    const rahulOffers = harness.listMyOffers('opp-rahul');
    assert.equal(rahulOffers.length, 1, 'Rahul sees exactly ONE card for the fixture');
    assert.equal(rahulOffers[0]?.challenge_id, challenge.id);
    assert.equal(rahulOffers[0]?.status, 'offered');

    // Step D: Rahul taps "Send Request" with his squad
    harness.applyToOpenChallenge(challenge.id, 'rahul-squad-1', 'opp-rahul');

    // Step E: Verify Rahul's card state updates to 'interested'
    const updatedOffers = harness.listMyOffers('opp-rahul');
    assert.equal(updatedOffers.length, 1);
    assert.equal(updatedOffers[0]?.status, 'interested', 'Card status moves to interested');

    // Step F: Host receives challenge_interest notification
    const hostNotifs = harness.notificationJobs.filter(
      (j) => j.user_id === 'host-id' && j.kind === 'challenge_interest',
    );
    assert.equal(hostNotifs.length, 1, 'Host received "challenge_interest" push notification');
    assert.equal(hostNotifs[0]?.data.challengeId, challenge.id);
  });

  it('Flow 2: Global browsing of newly posted fixtures by out-of-radius players while notification is only sent to in-radius captains', () => {
    // 1. Host in Pune posts fixture with tight 5km radius
    harness.createUser('host-pune', 'Pune Host', puneCenter.lat, puneCenter.lng);
    harness.createTeam('team-pune', 'Pune Warriors', 'box_cricket', 'host-pune', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`pm-${i}`, `P ${i}`, puneCenter.lat, puneCenter.lng);
      harness.addTeamMember('team-pune', `pm-${i}`);
    }

    // 2. Out-of-radius player in Mumbai (~120km away)
    const mumbaiPoint = { lat: 18.9388, lng: 72.8258 };
    harness.createUser('player-mumbai', 'Mumbai Explorer', mumbaiPoint.lat, mumbaiPoint.lng);

    // Host posts challenge
    const ch = harness.postOpenChallenge({
      fromTeamId: 'team-pune',
      createdBy: 'host-pune',
      matchName: 'Pune Derby',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 5000, // 5 km play zone radius
      lat: puneCenter.lat,
      lng: puneCenter.lng,
    });

    // Also mirror to matches table for in-app matches feed
    harness.matches.set(ch.id, {
      id: ch.id,
      creator_id: 'host-pune',
      sport: 'box_cricket',
      venue_id: null,
      venue_text: 'Pune Stadium',
      area_name: 'Pune',
      scheduled_at: ch.scheduled_at,
      end_time: null,
      total_slots: 8,
      filled_slots: 4,
      missing_count: 4,
      share_code: 'PUN001',
      lat: puneCenter.lat,
      lng: puneCenter.lng,
      match_lat: puneCenter.lat,
      match_lng: puneCenter.lng,
      match_name: 'Pune Derby',
      status: 'open',
      match_type: 'open',
      search_radius_m: 5000,
      challenge_id: ch.id,
    });

    // Verification 1: Mumbai player did NOT receive any push notification
    const mumbaiNotifs = harness.notificationJobs.filter((j) => j.user_id === 'player-mumbai');
    assert.equal(mumbaiNotifs.length, 0, 'Mumbai player received no push notification (out of radius)');

    // Verification 2: Mumbai player opens Games tab and browses globally (radiusM: null or "All")
    const globalMatches = harness.nearbyMatches({
      lat: mumbaiPoint.lat,
      lng: mumbaiPoint.lng,
      radiusM: null, // "All" distance chip
      sport: 'box_cricket',
    });

    const matchFound = globalMatches.find((m) => m.id === ch.id);
    assert.ok(matchFound, 'Mumbai player successfully browses and views Pune fixture in global feed');

    // Verification 3: Mumbai player browses open challenges rail globally
    const openFixtures = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: null,
      callerUserId: 'player-mumbai',
    });

    const challengeFound = openFixtures.find((c) => c.challenge_id === ch.id);
    assert.ok(challengeFound, 'Mumbai player successfully discovers Pune open fixture in open challenges rail');
  });
});
