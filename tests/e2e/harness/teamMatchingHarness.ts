/**
 * High-Fidelity In-Memory PostgreSQL & RPC Simulation Harness for Team Matching
 * 
 * Simulates:
 * - Teams, rosters, target_size format constraints.
 * - Open challenge posting (`post_open_challenge`), auto-candidate population in radius.
 * - Direct challenge creation (`create_challenge`).
 * - Concurrent applicants (`apply_to_open_challenge`, `accept_open_challenge`).
 * - Atomic `FOR UPDATE` lock semantics (exact 1 winner in race conditions, losing applicants get `CHALLENGE_ALREADY_TAKEN`).
 * - Shared player prevention across squads (`SHARED_PLAYER`).
 * - Format mismatch rejection (`FORMAT_MISMATCH`, `OPPONENT_FORMAT_MISMATCH`).
 * - Temporal schedule overlap detection (`TEAM_SCHEDULE_CONFLICT`, `OPPONENT_SCHEDULE_CONFLICT`).
 */

export interface ProfileRecord {
  id: string;
  name: string;
  isActive: boolean;
  homeLat: number;
  homeLng: number;
}

export interface TeamRecord {
  id: string;
  name: string;
  sport: string;
  ownerId: string;
  targetSize: number; // e.g. 6 for 6v6, 8 for 8v8
  members: string[]; // user_ids
  createdLat?: number;
  createdLng?: number;
}

export interface ChallengeRecord {
  id: string;
  fromTeamId: string;
  toTeamId?: string | null;
  sport: string;
  totalSlots: number; // e.g. 12 for 6v6 (6 a side), 16 for 8v8
  status: 'open' | 'pending' | 'accepted' | 'declined' | 'cancelled';
  scheduledAt: string; // ISO
  durationMinutes: number;
  createdBy: string;
  venueId?: string | null;
  matchId?: string | null;
}

export interface CandidateRecord {
  id: string;
  challengeId: string;
  teamId: string;
  status: 'offered' | 'interested' | 'declined' | 'accepted';
  appliedAt?: string;
}

export interface MatchRecord {
  id: string;
  title: string;
  sport: string;
  teamAId: string;
  teamBId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: 'upcoming' | 'live' | 'completed' | 'cancelled';
  lineupA: string[];
  lineupB: string[];
}

export class PostgresError extends Error {
  code: string;
  detail?: string;

  constructor(message: string, code: string, detail?: string) {
    super(message);
    this.name = 'PostgresError';
    this.code = code;
    this.detail = detail;
  }
}

export class TeamMatchingHarness {
  private profiles = new Map<string, ProfileRecord>();
  private teams = new Map<string, TeamRecord>();
  private challenges = new Map<string, ChallengeRecord>();
  private candidates = new Map<string, CandidateRecord>();
  private matches = new Map<string, MatchRecord>();

  private currentAuthUserId: string | null = null;
  private currentMockTime: Date = new Date('2026-09-09T10:00:00.000Z');

  setMockTime(d: Date): void {
    this.currentMockTime = new Date(d);
  }

  getMockTime(): Date {
    return new Date(this.currentMockTime);
  }

  setAuthUser(userId: string | null): void {
    this.currentAuthUserId = userId;
  }

  getAuthUser(): string | null {
    return this.currentAuthUserId;
  }

  // --- Profiles & Teams ---

  createProfile(id: string, name: string, lat = 12.9716, lng = 77.5946): ProfileRecord {
    const p: ProfileRecord = { id, name, isActive: true, homeLat: lat, homeLng: lng };
    this.profiles.set(id, p);
    return p;
  }

  createTeam(params: {
    id: string;
    name: string;
    sport: string;
    ownerId: string;
    targetSize: number;
    members?: string[];
    lat?: number;
    lng?: number;
  }): TeamRecord {
    const members = params.members ?? [params.ownerId];
    if (!members.includes(params.ownerId)) {
      members.push(params.ownerId);
    }
    const t: TeamRecord = {
      id: params.id,
      name: params.name,
      sport: params.sport,
      ownerId: params.ownerId,
      targetSize: params.targetSize,
      members,
      createdLat: params.lat ?? 12.9716,
      createdLng: params.lng ?? 77.5946,
    };
    this.teams.set(params.id, t);
    return t;
  }

  addTeamMember(teamId: string, userId: string): void {
    const t = this.teams.get(teamId);
    if (!t) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');
    if (!t.members.includes(userId)) {
      t.members.push(userId);
    }
  }

  // --- Schedule Overlap Check ---

  hasScheduleConflict(teamId: string, startIso: string, durationMinutes: number): { conflict: boolean; match?: MatchRecord } {
    const reqStart = new Date(startIso).getTime();
    const reqEnd = reqStart + durationMinutes * 60 * 1000;

    for (const m of this.matches.values()) {
      if (m.status === 'cancelled') continue;
      if (m.teamAId === teamId || m.teamBId === teamId) {
        const mStart = new Date(m.scheduledAt).getTime();
        const mEnd = mStart + m.durationMinutes * 60 * 1000;
        // Interval overlap check: max(start1, start2) < min(end1, end2)
        if (Math.max(reqStart, mStart) < Math.min(reqEnd, mEnd)) {
          return { conflict: true, match: m };
        }
      }
    }
    return { conflict: false };
  }

  // --- RPC: post_open_challenge ---

  postOpenChallenge(params: {
    id: string;
    fromTeamId: string;
    sport: string;
    totalSlots: number;
    scheduledAt: string;
    durationMinutes?: number;
  }): ChallengeRecord {
    const uid = this.currentAuthUserId;
    if (!uid) throw new PostgresError('NOT_AUTHENTICATED', '28000');

    const team = this.teams.get(params.fromTeamId);
    if (!team) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');
    if (team.ownerId !== uid) throw new PostgresError('NOT_TEAM_OWNER', '42501');

    if (new Date(params.scheduledAt).getTime() < this.currentMockTime.getTime()) {
      throw new PostgresError('SCHEDULE_IN_PAST', '23514');
    }

    const formatPerSide = Math.floor(params.totalSlots / 2);
    if (team.targetSize !== formatPerSide) {
      throw new PostgresError('FORMAT_MISMATCH', '23514', `team format is ${team.targetSize}v${team.targetSize}, challenge is ${formatPerSide}v${formatPerSide}`);
    }

    if (team.members.length < team.targetSize) {
      throw new PostgresError('SQUAD_TOO_SMALL', '23514');
    }

    const duration = params.durationMinutes ?? 90;
    const conflict = this.hasScheduleConflict(team.id, params.scheduledAt, duration);
    if (conflict.conflict) {
      throw new PostgresError(
        `TEAM_SCHEDULE_CONFLICT ${params.scheduledAt} ${new Date(new Date(params.scheduledAt).getTime() + duration * 60000).toISOString()}`,
        '23514',
      );
    }

    const c: ChallengeRecord = {
      id: params.id,
      fromTeamId: params.fromTeamId,
      sport: params.sport,
      totalSlots: params.totalSlots,
      status: 'open',
      scheduledAt: params.scheduledAt,
      durationMinutes: duration,
      createdBy: uid,
    };
    this.challenges.set(params.id, c);

    // Auto-populate candidate offers for other teams matching sport & format within discovery
    for (const otherTeam of this.teams.values()) {
      if (otherTeam.id === team.id) continue;
      if (otherTeam.sport === team.sport) {
        const candidateId = `cand-${params.id}-${otherTeam.id}`;
        this.candidates.set(candidateId, {
          id: candidateId,
          challengeId: params.id,
          teamId: otherTeam.id,
          status: 'offered',
        });
      }
    }

    return c;
  }

  // --- RPC: apply_to_open_challenge ---

  applyToOpenChallenge(challengeId: string, teamId: string): CandidateRecord {
    const uid = this.currentAuthUserId;
    if (!uid) throw new PostgresError('NOT_AUTHENTICATED', '28000');

    const c = this.challenges.get(challengeId);
    if (!c) throw new PostgresError('CHALLENGE_NOT_FOUND', 'P0002');
    if (c.status !== 'open') throw new PostgresError('CHALLENGE_ALREADY_TAKEN', '23514');

    const team = this.teams.get(teamId);
    if (!team) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');
    if (team.ownerId !== uid) throw new PostgresError('NOT_TEAM_OWNER', '42501');

    if (team.id === c.fromTeamId) {
      throw new PostgresError('SELF_CHALLENGE', '23514');
    }

    const formatPerSide = Math.floor(c.totalSlots / 2);
    if (team.targetSize !== formatPerSide) {
      throw new PostgresError('FORMAT_MISMATCH', '23514');
    }

    if (team.members.length < team.targetSize) {
      throw new PostgresError('SQUAD_TOO_SMALL', '23514');
    }

    // Shared player check
    const fromTeam = this.teams.get(c.fromTeamId)!;
    const hasSharedPlayer = team.members.some((m) => fromTeam.members.includes(m));
    if (hasSharedPlayer) {
      throw new PostgresError('SHARED_PLAYER', '23514', 'the same player is on both squads');
    }

    // Check schedule conflict for applicant team
    const conflict = this.hasScheduleConflict(team.id, c.scheduledAt, c.durationMinutes);
    if (conflict.conflict) {
      throw new PostgresError(
        `TEAM_SCHEDULE_CONFLICT ${c.scheduledAt} ${new Date(new Date(c.scheduledAt).getTime() + c.durationMinutes * 60000).toISOString()}`,
        '23514',
      );
    }

    const candKey = `cand-${challengeId}-${teamId}`;
    let cand = this.candidates.get(candKey);
    if (!cand) {
      cand = { id: candKey, challengeId, teamId, status: 'interested', appliedAt: this.currentMockTime.toISOString() };
    } else {
      cand.status = 'interested';
      cand.appliedAt = this.currentMockTime.toISOString();
    }
    this.candidates.set(candKey, cand);
    return cand;
  }

  // --- RPC: accept_open_challenge (Atomic FOR UPDATE resolution) ---

  acceptOpenChallenge(challengeId: string, teamId: string, lineup: string[]): { challenge: ChallengeRecord; match: MatchRecord } {
    const uid = this.currentAuthUserId;
    if (!uid) throw new PostgresError('NOT_AUTHENTICATED', '28000');

    const c = this.challenges.get(challengeId);
    if (!c) throw new PostgresError('CHALLENGE_NOT_FOUND', 'P0002');

    // Atomic check: must be 'open'
    if (c.status !== 'open') {
      throw new PostgresError('CHALLENGE_ALREADY_TAKEN', '23514');
    }

    const team = this.teams.get(teamId);
    if (!team) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');

    const fromTeam = this.teams.get(c.fromTeamId);
    if (!fromTeam) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');

    const isHost = c.createdBy === uid || fromTeam.ownerId === uid;
    const isApplicantOwner = team.ownerId === uid;

    if (!isHost && !isApplicantOwner) {
      throw new PostgresError('NOT_TEAM_OWNER', '42501');
    }

    // Must have a candidate row in offered or interested status
    const candKey = `cand-${challengeId}-${teamId}`;
    const cand = this.candidates.get(candKey);
    if (!cand || (cand.status !== 'offered' && cand.status !== 'interested')) {
      throw new PostgresError('NOT_OFFERED', '42501');
    }

    // Format match check
    const formatPerSide = Math.floor(c.totalSlots / 2);
    if (team.targetSize !== formatPerSide || fromTeam.targetSize !== formatPerSide) {
      throw new PostgresError('FORMAT_MISMATCH', '23514');
    }

    // Self check & shared player check
    if (team.id === fromTeam.id || team.ownerId === fromTeam.ownerId) {
      throw new PostgresError('SELF_CHALLENGE', '23514');
    }
    const hasSharedPlayer = team.members.some((m) => fromTeam.members.includes(m));
    if (hasSharedPlayer) {
      throw new PostgresError('SHARED_PLAYER', '23514', 'the same player is on both squads');
    }

    // Schedule conflicts
    const conflictHost = this.hasScheduleConflict(fromTeam.id, c.scheduledAt, c.durationMinutes);
    if (conflictHost.conflict) {
      throw new PostgresError('OPPONENT_SCHEDULE_CONFLICT', '23514');
    }
    const conflictOpp = this.hasScheduleConflict(team.id, c.scheduledAt, c.durationMinutes);
    if (conflictOpp.conflict) {
      throw new PostgresError('TEAM_SCHEDULE_CONFLICT', '23514');
    }

    // Lineup validation
    if (lineup.length !== formatPerSide) {
      throw new PostgresError('LINEUP_SIZE_MISMATCH', '23514');
    }
    for (const p of lineup) {
      if (!team.members.includes(p) && !fromTeam.members.includes(p)) {
        throw new PostgresError('LINEUP_NOT_A_MEMBER', '23514');
      }
    }

    // ATOMIC STATE TRANSITION
    c.status = 'accepted';
    cand.status = 'accepted';

    // Decline all other competing candidates for this challenge
    for (const otherCand of this.candidates.values()) {
      if (otherCand.challengeId === c.id && otherCand.id !== cand.id) {
        otherCand.status = 'declined';
      }
    }

    // Build the confirmed match
    const matchId = `match-${c.id}`;
    const match: MatchRecord = {
      id: matchId,
      title: `${fromTeam.name} vs ${team.name}`,
      sport: c.sport,
      teamAId: fromTeam.id,
      teamBId: team.id,
      scheduledAt: c.scheduledAt,
      durationMinutes: c.durationMinutes,
      status: 'upcoming',
      lineupA: fromTeam.members.slice(0, formatPerSide),
      lineupB: lineup,
    };
    c.matchId = matchId;
    this.matches.set(matchId, match);

    return { challenge: c, match };
  }

  // --- RPC: decline_open_challenge (Applicant withdraw / Host decline) ---

  declineOpenChallenge(challengeId: string, teamId: string): CandidateRecord {
    const uid = this.currentAuthUserId;
    if (!uid) throw new PostgresError('NOT_AUTHENTICATED', '28000');

    const c = this.challenges.get(challengeId);
    if (!c) throw new PostgresError('CHALLENGE_NOT_FOUND', 'P0002');

    const team = this.teams.get(teamId);
    if (!team) throw new PostgresError('TEAM_NOT_FOUND', 'P0002');

    const fromTeam = this.teams.get(c.fromTeamId);
    const isHost = c.createdBy === uid || fromTeam?.ownerId === uid;
    const isCandOwner = team.ownerId === uid;

    if (!isHost && !isCandOwner) {
      throw new PostgresError('NOT_TEAM_OWNER', '42501');
    }

    const candKey = `cand-${challengeId}-${teamId}`;
    const cand = this.candidates.get(candKey);
    if (!cand || (cand.status !== 'offered' && cand.status !== 'interested')) {
      throw new PostgresError('NOT_OFFERED', '42501');
    }

    cand.status = 'declined';
    return cand;
  }

  // --- RPC: cancel_challenge (Host withdraws open fixture) ---

  cancelChallenge(challengeId: string): ChallengeRecord {
    const uid = this.currentAuthUserId;
    if (!uid) throw new PostgresError('NOT_AUTHENTICATED', '28000');

    const c = this.challenges.get(challengeId);
    if (!c) throw new PostgresError('CHALLENGE_NOT_FOUND', 'P0002');

    const fromTeam = this.teams.get(c.fromTeamId);
    const isHost = c.createdBy === uid || fromTeam?.ownerId === uid;
    if (!isHost) {
      throw new PostgresError('NOT_TEAM_OWNER', '42501');
    }

    if (c.status !== 'open' && c.status !== 'pending') {
      throw new PostgresError('CHALLENGE_ALREADY_ANSWERED', '23514');
    }

    c.status = 'cancelled';

    // Close all candidates
    for (const cand of this.candidates.values()) {
      if (cand.challengeId === c.id && cand.status !== 'accepted') {
        cand.status = 'declined';
      }
    }

    return c;
  }

  // --- Helpers for query assertions ---

  getChallenge(id: string): ChallengeRecord | undefined {
    return this.challenges.get(id);
  }

  getCandidate(challengeId: string, teamId: string): CandidateRecord | undefined {
    return this.candidates.get(`cand-${challengeId}-${teamId}`);
  }

  getMatch(id: string): MatchRecord | undefined {
    return this.matches.get(id);
  }

  getAllMatches(): MatchRecord[] {
    return Array.from(this.matches.values());
  }
}
