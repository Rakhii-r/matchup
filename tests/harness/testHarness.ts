/**
 * Test Harness for Geospatial Play-Zone Targeting, Public Discovery & Offers Deduplication
 * 
 * Provides:
 * 1. High-precision PostGIS / WGS84 ellipsoidal spatial distance math (Haversine in meters).
 * 2. In-memory data store modeling Postgres tables:
 *    - profiles (with home_location)
 *    - teams (with target_size, owner_id)
 *    - team_members
 *    - team_challenges
 *    - challenge_candidates
 *    - notification_jobs
 *    - matches
 * 3. Exact algorithmic replication of database RPCs:
 *    - public.team_location
 *    - public.rank_challenge_candidates (with DISTINCT ON captain)
 *    - public.post_open_challenge (with single notification per captain)
 *    - public.nearby_matches (with nullable coords/radius global fallback)
 *    - public.list_open_challenges_nearby (with nullable format/radius fallback)
 *    - public.decline_open_challenge (with cascade across owner's squads)
 * 4. Client-side deduplication simulator matching challengeRepository.listMyOffers.
 */

import type { Sport } from '@shared/types/database.types';
import type { OpenOffer } from '@features/teams/domain/challengeSchema';

export interface TestGeoPoint {
  lat: number;
  lng: number;
}

export interface ProfileRecord {
  id: string;
  full_name: string;
  home_lat: number | null;
  home_lng: number | null;
  is_active: boolean;
  notif_prefs: Record<string, boolean>;
}

export interface TeamRecord {
  id: string;
  name: string;
  sport: Sport;
  owner_id: string;
  target_size: number;
}

export interface TeamMemberRecord {
  team_id: string;
  user_id: string;
  role: 'owner' | 'member';
}

export interface TeamChallengeRecord {
  id: string;
  from_team_id: string;
  to_team_id: string | null;
  created_by: string;
  match_name: string;
  venue_id: string | null;
  scheduled_at: string;
  total_slots: number;
  message: string | null;
  status: 'open' | 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  search_radius_m: number;
  area_name: string | null;
  game_type: 'friendly' | 'competitive';
  end_time: string | null;
  match_lat: number | null;
  match_lng: number | null;
  match_id: string | null;
  created_at: string;
}

export interface ChallengeCandidateRecord {
  id: string;
  challenge_id: string;
  team_id: string;
  rank: number;
  distance_m: number;
  status: 'offered' | 'interested' | 'accepted' | 'declined' | 'expired';
  created_at: string;
  responded_at: string | null;
}

export interface NotificationJobRecord {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface MatchRecord {
  id: string;
  creator_id: string;
  sport: Sport;
  venue_id: string | null;
  venue_text: string | null;
  area_name: string | null;
  scheduled_at: string;
  end_time: string | null;
  total_slots: number;
  filled_slots: number;
  missing_count: number;
  share_code: string;
  lat: number | null;
  lng: number | null;
  match_lat: number | null;
  match_lng: number | null;
  match_name: string;
  status: 'open' | 'locked' | 'completed' | 'cancelled' | 'expired';
  match_type: 'open' | 'team_vs_team';
  search_radius_m: number | null;
  challenge_id: string | null;
}

/**
 * Earth radius in meters (WGS84 authalic sphere used by PostGIS geography)
 */
export const EARTH_RADIUS_METERS = 6371008.8;

/**
 * Calculates geodesic distance between two points in meters using the Haversine formula.
 * Matches PostGIS ST_Distance(geography, geography) within 0.1%.
 */
export function calculateGeodesicDistanceMeters(
  point1: TestGeoPoint,
  point2: TestGeoPoint,
): number {
  const lat1Rad = (point1.lat * Math.PI) / 180;
  const lat2Rad = (point2.lat * Math.PI) / 180;
  const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const deltaLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Generates a geographic point at an exact distance (in meters) and bearing (in degrees) from origin.
 */
export function createPointAtDistance(
  origin: TestGeoPoint,
  distanceMeters: number,
  bearingDegrees: number = 0,
): TestGeoPoint {
  const r = EARTH_RADIUS_METERS;
  const delta = distanceMeters / r;
  const theta = (bearingDegrees * Math.PI) / 180;

  const phi1 = (origin.lat * Math.PI) / 180;
  const lambda1 = (origin.lng * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );

  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );

  return {
    lat: (phi2 * 180) / Math.PI,
    lng: (lambda2 * 180) / Math.PI,
  };
}

export class MatchupDatabaseHarness {
  profiles: Map<string, ProfileRecord> = new Map();
  teams: Map<string, TeamRecord> = new Map();
  teamMembers: TeamMemberRecord[] = [];
  teamChallenges: Map<string, TeamChallengeRecord> = new Map();
  challengeCandidates: Map<string, ChallengeCandidateRecord> = new Map();
  notificationJobs: NotificationJobRecord[] = [];
  matches: Map<string, MatchRecord> = new Map();

  reset(): void {
    this.profiles.clear();
    this.teams.clear();
    this.teamMembers = [];
    this.teamChallenges.clear();
    this.challengeCandidates.clear();
    this.notificationJobs = [];
    this.matches.clear();
  }

  // --- Population Helpers ---

  createUser(id: string, name: string, lat: number | null = null, lng: number | null = null): ProfileRecord {
    const user: ProfileRecord = {
      id,
      full_name: name,
      home_lat: lat,
      home_lng: lng,
      is_active: true,
      notif_prefs: {},
    };
    this.profiles.set(id, user);
    return user;
  }

  createTeam(id: string, name: string, sport: Sport, ownerId: string, formatPerSide: number): TeamRecord {
    const team: TeamRecord = {
      id,
      name,
      sport,
      owner_id: ownerId,
      target_size: formatPerSide,
    };
    this.teams.set(id, team);
    this.teamMembers.push({ team_id: id, user_id: ownerId, role: 'owner' });
    return team;
  }

  addTeamMember(teamId: string, userId: string, role: 'owner' | 'member' = 'member'): void {
    this.teamMembers.push({ team_id: teamId, user_id: userId, role });
  }

  // --- PostGIS Spatial & Business Logic RPC Replications ---

  /**
   * Replicates public.team_location(team_id):
   * Centroid of active team members' home locations.
   */
  getTeamLocation(teamId: string): TestGeoPoint | null {
    const memberIds = this.teamMembers
      .filter((tm) => tm.team_id === teamId)
      .map((tm) => tm.user_id);

    const locations = memberIds
      .map((uid) => this.profiles.get(uid))
      .filter((p): p is ProfileRecord => p != null && p.is_active && p.home_lat != null && p.home_lng != null)
      .map((p) => ({ lat: p.home_lat as number, lng: p.home_lng as number }));

    if (locations.length === 0) return null;

    const sumLat = locations.reduce((acc, loc) => acc + loc.lat, 0);
    const sumLng = locations.reduce((acc, loc) => acc + loc.lng, 0);
    return {
      lat: sumLat / locations.length,
      lng: sumLng / locations.length,
    };
  }

  /**
   * Replicates public.rank_challenge_candidates(in_challenge_id, in_radius_m, in_limit):
   * Features:
   * 1. Geospatial radius filtering (ST_DWithin).
   * 2. Strict format matching: target_size == challenge_format(total_slots).
   * 3. Captain deduplication: DISTINCT ON (t.owner_id) picks the single closest team per captain.
   * 4. Self-match exclusions.
   */
  rankChallengeCandidates(
    challengeId: string,
    radiusM: number = 25000,
    limit: number = 5,
  ): { team_id: string; owner_id: string; distance_m: number; rank: number }[] {
    const ch = this.teamChallenges.get(challengeId);
    if (!ch) return [];

    const fromTeam = this.teams.get(ch.from_team_id);
    if (!fromTeam) return [];

    const originLocation: TestGeoPoint | null =
      ch.match_lat != null && ch.match_lng != null
        ? { lat: ch.match_lat, lng: ch.match_lng }
        : this.getTeamLocation(ch.from_team_id);

    if (!originLocation) return [];

    const expectedFormat = Math.max(Math.floor(ch.total_slots / 2), 1);
    const fromTeamMembers = new Set(
      this.teamMembers.filter((tm) => tm.team_id === ch.from_team_id).map((tm) => tm.user_id),
    );

    interface CandidateCandidate {
      team_id: string;
      owner_id: string;
      distance_m: number;
    }

    const eligible: CandidateCandidate[] = [];

    for (const team of this.teams.values()) {
      if (team.id === ch.from_team_id) continue;
      if (team.sport !== fromTeam.sport) continue;
      if (team.target_size !== expectedFormat) continue;

      // Squad size check
      const memberCount = this.teamMembers.filter((tm) => tm.team_id === team.id).length;
      if (memberCount < expectedFormat) continue;

      // Self-match rules
      if (team.owner_id === ch.created_by) continue;
      if (this.teamMembers.some((tm) => tm.team_id === team.id && tm.user_id === ch.created_by)) continue;

      // Overlapping members rule
      const teamMembers = this.teamMembers.filter((tm) => tm.team_id === team.id).map((tm) => tm.user_id);
      const hasOverlap = teamMembers.some((uid) => fromTeamMembers.has(uid));
      if (hasOverlap) continue;

      // Active captain check
      const captain = this.profiles.get(team.owner_id);
      if (!captain || !captain.is_active) continue;

      // Geodesic location check
      const teamLoc = this.getTeamLocation(team.id);
      if (!teamLoc) continue;

      const dist = calculateGeodesicDistanceMeters(teamLoc, originLocation);
      if (dist <= radiusM) {
        eligible.push({
          team_id: team.id,
          owner_id: team.owner_id,
          distance_m: dist,
        });
      }
    }

    // DISTINCT ON (t.owner_id) ORDER BY t.owner_id, ST_Distance asc
    const closestPerOwner = new Map<string, CandidateCandidate>();
    for (const cand of eligible) {
      const existing = closestPerOwner.get(cand.owner_id);
      if (!existing || cand.distance_m < existing.distance_m) {
        closestPerOwner.set(cand.owner_id, cand);
      }
    }

    // Rank candidates by distance_m asc
    const sorted = Array.from(closestPerOwner.values()).sort((a, b) => a.distance_m - b.distance_m);
    const sliced = sorted.slice(0, limit);

    return sliced.map((c, index) => ({
      ...c,
      rank: index + 1,
    }));
  }

  /**
   * Replicates public.post_open_challenge:
   * 1. Inserts challenge.
   * 2. Calls rank_challenge_candidates.
   * 3. Inserts candidates into challenge_candidates.
   * 4. Enqueues challenge_offer notification STRICTLY ONCE per captain (v_notified_users array).
   */
  postOpenChallenge(input: {
    fromTeamId: string;
    createdBy: string;
    matchName: string;
    scheduledAt: string;
    totalSlots: number;
    radiusM?: number;
    lat?: number | null;
    lng?: number | null;
  }): TeamChallengeRecord {
    const chId = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const radiusM = input.radiusM ?? 25000;

    const challenge: TeamChallengeRecord = {
      id: chId,
      from_team_id: input.fromTeamId,
      to_team_id: null,
      created_by: input.createdBy,
      match_name: input.matchName,
      venue_id: null,
      scheduled_at: input.scheduledAt,
      total_slots: input.totalSlots,
      message: null,
      status: 'open',
      search_radius_m: radiusM,
      area_name: 'Local Ground',
      game_type: 'friendly',
      end_time: null,
      match_lat: input.lat ?? null,
      match_lng: input.lng ?? null,
      match_id: null,
      created_at: new Date().toISOString(),
    };

    this.teamChallenges.set(chId, challenge);

    const candidates = this.rankChallengeCandidates(chId, radiusM, 5);
    const notifiedUsers = new Set<string>();

    for (const cand of candidates) {
      const candId = `cand-${chId}-${cand.team_id}`;
      this.challengeCandidates.set(candId, {
        id: candId,
        challenge_id: chId,
        team_id: cand.team_id,
        rank: cand.rank,
        distance_m: cand.distance_m,
        status: 'offered',
        created_at: new Date().toISOString(),
        responded_at: null,
      });

      const team = this.teams.get(cand.team_id);
      if (team && !notifiedUsers.has(team.owner_id)) {
        notifiedUsers.add(team.owner_id);
        this.notificationJobs.push({
          id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          user_id: team.owner_id,
          kind: 'challenge_offer',
          title: 'Match offer',
          body: `${this.teams.get(input.fromTeamId)?.name ?? 'A team'} wants a game. Tap to accept.`,
          data: { route: '/teams/offers', challenge_id: chId },
          created_at: new Date().toISOString(),
        });
      }
    }

    return challenge;
  }

  /**
   * Replicates challengeRepository.listMyOffers:
   * 1. Finds candidate rows for all squads owned or joined by the user.
   * 2. Deduplicates by challenge_id so the user receives exactly ONE offer card per fixture.
   * 3. Prioritizes 'interested' status over 'offered'.
   * 4. Excludes non-open fixtures.
   */
  listMyOffers(userId: string): OpenOffer[] {
    const myTeamIds = new Set(
      this.teamMembers.filter((tm) => tm.user_id === userId).map((tm) => tm.team_id),
    );

    if (myTeamIds.size === 0) return [];

    const rawOffers: OpenOffer[] = [];
    for (const cand of this.challengeCandidates.values()) {
      if (!myTeamIds.has(cand.team_id)) continue;
      if (cand.status !== 'offered' && cand.status !== 'interested') continue;

      const challenge = this.teamChallenges.get(cand.challenge_id);
      if (!challenge || challenge.status !== 'open') continue;

      const team = this.teams.get(cand.team_id);

      rawOffers.push({
        id: cand.id,
        challenge_id: cand.challenge_id,
        team_id: cand.team_id,
        rank: cand.rank,
        distance_m: cand.distance_m,
        status: cand.status,
        created_at: cand.created_at,
        team: team ? { name: team.name } : null,
        challenge: {
          id: challenge.id,
          match_name: challenge.match_name,
          scheduled_at: challenge.scheduled_at,
          total_slots: challenge.total_slots,
          message: challenge.message,
          status: challenge.status,
          from_team_id: challenge.from_team_id,
        },
      });
    }

    // Deduplicate by challenge_id: exactly 1 card per fixture
    const dedupedMap = new Map<string, OpenOffer>();
    for (const offer of rawOffers) {
      const existing = dedupedMap.get(offer.challenge_id);
      if (!existing) {
        dedupedMap.set(offer.challenge_id, offer);
      } else if (existing.status !== 'interested' && offer.status === 'interested') {
        dedupedMap.set(offer.challenge_id, offer);
      }
    }

    return Array.from(dedupedMap.values());
  }

  /**
   * Replicates public.decline_open_challenge with cascade:
   * Declining an offer cascades across all candidate rows owned by the user for that fixture,
   * completely preventing "zombie" offers.
   */
  declineOpenChallenge(challengeId: string, teamId: string, callerUserId: string): void {
    const userOwnedTeamIds = new Set(
      Array.from(this.teams.values())
        .filter((t) => t.owner_id === callerUserId)
        .map((t) => t.id),
    );

    for (const cand of this.challengeCandidates.values()) {
      if (cand.challenge_id === challengeId && userOwnedTeamIds.has(cand.team_id)) {
        cand.status = 'declined';
        cand.responded_at = new Date().toISOString();
      }
    }
  }

  /**
   * Replicates public.apply_to_open_challenge:
   * Moves candidate status to 'interested', enqueues 'challenge_interest' to host.
   */
  applyToOpenChallenge(challengeId: string, teamId: string, callerUserId: string): void {
    const team = this.teams.get(teamId);
    if (!team || team.owner_id !== callerUserId) {
      throw new Error('NOT_TEAM_OWNER');
    }

    const ch = this.teamChallenges.get(challengeId);
    if (!ch || ch.status !== 'open') {
      throw new Error('CHALLENGE_NOT_FOUND');
    }

    let cand = Array.from(this.challengeCandidates.values()).find(
      (c) => c.challenge_id === challengeId && c.team_id === teamId,
    );

    if (!cand) {
      const id = `cand-${challengeId}-${teamId}`;
      cand = {
        id,
        challenge_id: challengeId,
        team_id: teamId,
        rank: 1,
        distance_m: 0,
        status: 'interested',
        created_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
      };
      this.challengeCandidates.set(id, cand);
    } else {
      cand.status = 'interested';
      cand.responded_at = new Date().toISOString();
    }

    this.notificationJobs.push({
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: ch.created_by,
      kind: 'challenge_interest',
      title: 'New Match Request!',
      body: `${team.name} wants to play your fixture. Tap to review.`,
      data: { route: '/match/create/searching', challengeId },
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Replicates public.nearby_matches:
   * When coordinates or radius are null, returns all open matches sorted by scheduled_at asc.
   * When coordinates and radius are provided, filters by ST_DWithin and sorts by distance.
   */
  nearbyMatches(input: {
    lat: number | null;
    lng: number | null;
    radiusM: number | null;
    sport: Sport | null;
  }): MatchRecord[] {
    let rows = Array.from(this.matches.values()).filter((m) => m.status === 'open');

    if (input.sport) {
      rows = rows.filter((m) => m.sport === input.sport);
    }

    const hasLocationFilter =
      input.lat != null && input.lng != null && input.radiusM != null && input.radiusM > 0;

    if (!hasLocationFilter) {
      return rows.sort(
        (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
      );
    }

    const userLoc: TestGeoPoint = { lat: input.lat as number, lng: input.lng as number };
    const radiusM = input.radiusM as number;

    const withDist = rows
      .map((m) => {
        const mLoc =
          m.lat != null && m.lng != null ? { lat: m.lat, lng: m.lng } : null;
        const dist = mLoc ? calculateGeodesicDistanceMeters(userLoc, mLoc) : Infinity;
        return { match: m, dist };
      })
      .filter((item) => item.dist <= radiusM);

    withDist.sort((a, b) => a.dist - b.dist);
    return withDist.map((item) => item.match);
  }

  /**
   * Replicates public.list_open_challenges_nearby:
   * When teamSize is null, returns all open challenges without format restriction.
   * When radius/coords are null, returns all open challenges globally.
   */
  listOpenChallengesNearby(input: {
    lat: number | null;
    lng: number | null;
    radiusM: number | null;
    sport: string | null;
    teamSize: number | null;
    callerUserId: string | null;
  }): {
    challenge_id: string;
    match_name: string;
    from_team_id: string;
    from_team_name: string;
    sport: string;
    distance_m: number;
    scheduled_at: string;
    total_slots: number;
  }[] {
    let openChallenges = Array.from(this.teamChallenges.values()).filter((c) => c.status === 'open');

    if (input.sport) {
      openChallenges = openChallenges.filter((c) => {
        const t = this.teams.get(c.from_team_id);
        return t && t.sport === input.sport;
      });
    }

    if (input.teamSize != null) {
      openChallenges = openChallenges.filter(
        (c) => Math.max(Math.floor(c.total_slots / 2), 1) === input.teamSize,
      );
    }

    if (input.callerUserId) {
      openChallenges = openChallenges.filter((c) => {
        if (c.created_by === input.callerUserId) return false;
        const isMember = this.teamMembers.some(
          (tm) => tm.team_id === c.from_team_id && tm.user_id === input.callerUserId,
        );
        return !isMember;
      });
    }

    const hasLocation = input.lat != null && input.lng != null;
    const userLoc: TestGeoPoint | null = hasLocation ? { lat: input.lat as number, lng: input.lng as number } : null;

    const results = openChallenges.map((c) => {
      const fromTeam = this.teams.get(c.from_team_id);
      const cLoc: TestGeoPoint | null =
        c.match_lat != null && c.match_lng != null
          ? { lat: c.match_lat, lng: c.match_lng }
          : this.getTeamLocation(c.from_team_id);

      const dist = userLoc && cLoc ? calculateGeodesicDistanceMeters(userLoc, cLoc) : 0;

      return {
        challenge_id: c.id,
        match_name: c.match_name,
        from_team_id: c.from_team_id,
        from_team_name: fromTeam?.name ?? 'Unknown Team',
        sport: fromTeam?.sport ?? 'box_cricket',
        distance_m: dist,
        scheduled_at: c.scheduled_at,
        total_slots: c.total_slots,
      };
    });

    if (hasLocation && input.radiusM != null && input.radiusM > 0) {
      return results.filter((r) => r.distance_m <= (input.radiusM as number));
    }

    return results;
  }
}
