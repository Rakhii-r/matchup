/**
 * Tier 4 Tests: Real-World Scenarios - Multi-Squad League Workflow
 * 
 * Tests:
 * - End-to-end simulation of a multi-club league tournament:
 *   - Multiple captains with multi-squad clubs across varying formats (4v4, 6v6).
 *   - Concurrent open fixtures posted by league organizers.
 *   - Push notification distribution with strict play-zone targeting and zero multi-squad spam.
 *   - Captain Game Offers inbox showing clean 1:1 fixture card representation.
 *   - Simultaneous requests, declines, and global public discovery by fans and out-of-district players.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchupDatabaseHarness,
  createPointAtDistance,
  type TestGeoPoint,
} from '../harness/testHarness';

describe('Tier 4: Real-World Scenario - Multi-Squad League Tournament', () => {
  let harness: MatchupDatabaseHarness;
  const centralGround: TestGeoPoint = { lat: 18.5204, lng: 73.8567 }; // Pune Ground

  beforeEach(() => {
    harness = new MatchupDatabaseHarness();
  });

  it('Executes full realistic multi-squad league workflow', () => {
    // -------------------------------------------------------------------------
    // 1. League Ecosystem Setup
    // -------------------------------------------------------------------------

    // Organiser / Host (Apex Club)
    harness.createUser('mgr-apex', 'Apex League Manager', centralGround.lat, centralGround.lng);
    harness.createTeam('apex-4v4', 'Apex Strikers 4v4', 'box_cricket', 'mgr-apex', 4);
    harness.createTeam('apex-6v6', 'Apex Titans 6v6', 'box_cricket', 'mgr-apex', 6);
    for (let i = 1; i <= 5; i++) {
      harness.createUser(`apex-m${i}`, `Apex Member ${i}`, centralGround.lat, centralGround.lng);
      if (i <= 3) harness.addTeamMember('apex-4v4', `apex-m${i}`);
      harness.addTeamMember('apex-6v6', `apex-m${i}`);
    }

    // Club 1 (Knights Club - Captain Sameer) - Located 2.5 km north
    // Owns both a 4v4 squad and a 6v6 squad
    const ptSameer = createPointAtDistance(centralGround, 2500, 0);
    harness.createUser('mgr-sameer', 'Sameer Captain', ptSameer.lat, ptSameer.lng);
    harness.createTeam('knights-4v4', 'Pune Knights 4v4', 'box_cricket', 'mgr-sameer', 4);
    harness.createTeam('knights-6v6', 'Pune Knights 6v6', 'box_cricket', 'mgr-sameer', 6);
    for (let i = 1; i <= 5; i++) {
      harness.createUser(`knights-m${i}`, `Knight ${i}`, ptSameer.lat, ptSameer.lng);
      if (i <= 3) harness.addTeamMember('knights-4v4', `knights-m${i}`);
      harness.addTeamMember('knights-6v6', `knights-m${i}`);
    }

    // Club 2 (Warriors Club - Captain Arjun) - Located 4.0 km east
    // Owns TWO 4v4 squads ("Warriors Red" and "Warriors Blue")
    const ptArjun = createPointAtDistance(centralGround, 4000, 90);
    harness.createUser('mgr-arjun', 'Arjun Captain', ptArjun.lat, ptArjun.lng);
    harness.createTeam('warriors-red', 'Warriors Red 4v4', 'box_cricket', 'mgr-arjun', 4);
    harness.createTeam('warriors-blue', 'Warriors Blue 4v4', 'box_cricket', 'mgr-arjun', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`wr-m${i}`, `WR ${i}`, ptArjun.lat, ptArjun.lng);
      harness.addTeamMember('warriors-red', `wr-m${i}`);
      harness.createUser(`wb-m${i}`, `WB ${i}`, ptArjun.lat, ptArjun.lng);
      harness.addTeamMember('warriors-blue', `wb-m${i}`);
    }

    // Club 3 (Casual Club - Captain Fatima) - Located 6.0 km south
    // Owns one 4v4 squad
    const ptFatima = createPointAtDistance(centralGround, 6000, 180);
    harness.createUser('mgr-fatima', 'Fatima Captain', ptFatima.lat, ptFatima.lng);
    harness.createTeam('fatima-4v4', 'Kothrud Casuals 4v4', 'box_cricket', 'mgr-fatima', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`fc-m${i}`, `FC ${i}`, ptFatima.lat, ptFatima.lng);
      harness.addTeamMember('fatima-4v4', `fc-m${i}`);
    }

    // Distant Club (Highlanders - Captain Dev) - Located 45 km west (Out of play zone)
    const ptDev = createPointAtDistance(centralGround, 45000, 270);
    harness.createUser('mgr-dev', 'Dev Captain', ptDev.lat, ptDev.lng);
    harness.createTeam('dev-4v4', 'Highlanders 4v4', 'box_cricket', 'mgr-dev', 4);
    for (let i = 1; i <= 3; i++) {
      harness.createUser(`dev-m${i}`, `Dev M${i}`, ptDev.lat, ptDev.lng);
      harness.addTeamMember('dev-4v4', `dev-m${i}`);
    }

    // Public Fan / Spectator (No squads, browsing globally)
    harness.createUser('fan-priya', 'Priya Spectator', null, null);

    // -------------------------------------------------------------------------
    // 2. League Posts Two Simultaneous Open Fixtures
    // -------------------------------------------------------------------------

    // Fixture 1: 4v4 League Match (Radius: 10,000 m)
    const fix4v4 = harness.postOpenChallenge({
      fromTeamId: 'apex-4v4',
      createdBy: 'mgr-apex',
      matchName: 'League Round 1: 4v4 Challenge',
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      totalSlots: 8,
      radiusM: 10000,
      lat: centralGround.lat,
      lng: centralGround.lng,
    });

    // Fixture 2: 6v6 League Match (Radius: 10,000 m)
    const fix6v6 = harness.postOpenChallenge({
      fromTeamId: 'apex-6v6',
      createdBy: 'mgr-apex',
      matchName: 'League Round 1: 6v6 Showcase',
      scheduledAt: new Date(Date.now() + 90000000).toISOString(),
      totalSlots: 12,
      radiusM: 10000,
      lat: centralGround.lat,
      lng: centralGround.lng,
    });

    // Mirror to public matches
    harness.matches.set(fix4v4.id, {
      id: fix4v4.id,
      creator_id: 'mgr-apex',
      sport: 'box_cricket',
      venue_id: null,
      venue_text: 'Central Turf Ground',
      area_name: 'Pune',
      scheduled_at: fix4v4.scheduled_at,
      end_time: null,
      total_slots: 8,
      filled_slots: 4,
      missing_count: 4,
      share_code: 'L4V4_01',
      lat: centralGround.lat,
      lng: centralGround.lng,
      match_lat: centralGround.lat,
      match_lng: centralGround.lng,
      match_name: fix4v4.match_name,
      status: 'open',
      match_type: 'open',
      search_radius_m: 10000,
      challenge_id: fix4v4.id,
    });

    // -------------------------------------------------------------------------
    // 3. Verification of Geo-Targeting & Notification Deduplication
    // -------------------------------------------------------------------------

    // Captain Arjun owns TWO 4v4 squads inside radius:
    // MUST receive strictly 1 notification for fix4v4, and 0 for fix6v6 (format mismatch)
    const arjunNotifs = harness.notificationJobs.filter((j) => j.user_id === 'mgr-arjun');
    assert.equal(arjunNotifs.length, 1, 'Arjun receives strictly 1 notification for 4v4 fixture');
    assert.equal(arjunNotifs[0]?.data.challenge_id, fix4v4.id);

    // Captain Sameer owns one 4v4 and one 6v6 squad:
    // Receives 1 notification for fix4v4 and 1 notification for fix6v6
    const sameerNotifs = harness.notificationJobs.filter((j) => j.user_id === 'mgr-sameer');
    assert.equal(sameerNotifs.length, 2, 'Sameer receives 1 notification per valid format fixture');

    // Captain Dev (45km away) must receive 0 notifications
    const devNotifs = harness.notificationJobs.filter((j) => j.user_id === 'mgr-dev');
    assert.equal(devNotifs.length, 0, 'Out-of-zone captain receives 0 notifications');

    // -------------------------------------------------------------------------
    // 4. Verification of Game Offers Screen Deduplication & Inbox Management
    // -------------------------------------------------------------------------

    // Captain Arjun checks his Game Offers (/teams/offers)
    const arjunOffers = harness.listMyOffers('mgr-arjun');
    assert.equal(
      arjunOffers.length,
      1,
      'Arjun sees exactly ONE offer card for fix4v4, not two for his two squads',
    );
    assert.equal(arjunOffers[0]?.challenge_id, fix4v4.id);
    assert.equal(arjunOffers[0]?.status, 'offered');

    // Arjun applies with Warriors Red
    harness.applyToOpenChallenge(fix4v4.id, 'warriors-red', 'mgr-arjun');

    // Re-verify Arjun's offers: card status updates to 'interested' without duplication
    const arjunUpdated = harness.listMyOffers('mgr-arjun');
    assert.equal(arjunUpdated.length, 1);
    assert.equal(arjunUpdated[0]?.status, 'interested');

    // Captain Fatima checks her Game Offers: sees 1 card for fix4v4
    const fatimaOffers = harness.listMyOffers('mgr-fatima');
    assert.equal(fatimaOffers.length, 1);
    assert.equal(fatimaOffers[0]?.challenge_id, fix4v4.id);

    // Fatima decides to decline the offer
    harness.declineOpenChallenge(fix4v4.id, 'fatima-4v4', 'mgr-fatima');

    // Fatima's inbox is now clean (0 offers)
    const fatimaPostDecline = harness.listMyOffers('mgr-fatima');
    assert.equal(fatimaPostDecline.length, 0, 'Fatima inbox clean after decline');

    // -------------------------------------------------------------------------
    // 5. Global Public Discovery Verification (Spectators & Distant Players)
    // -------------------------------------------------------------------------

    // Fan Priya (squadless, no GPS) opens the Games tab:
    // Discovers the fixture globally without blocking or distance lockout
    const priyaPublicMatches = harness.nearbyMatches({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
    });
    assert.ok(
      priyaPublicMatches.some((m) => m.id === fix4v4.id),
      'Spectator without location browses league fixture in global feed',
    );

    // Distant Captain Dev (45km away) opens Open Challenges feed:
    // Can browse the fixture globally and inspect details
    const devOpenFixtures = harness.listOpenChallengesNearby({
      lat: null,
      lng: null,
      radiusM: null,
      sport: 'box_cricket',
      teamSize: null,
      callerUserId: 'mgr-dev',
    });
    assert.ok(
      devOpenFixtures.some((c) => c.challenge_id === fix4v4.id),
      'Distant captain browses open fixture globally',
    );
  });
});
