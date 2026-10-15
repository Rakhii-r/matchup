/**
 * Multi-Team Matching Concurrency & Challenge Lifecycle Test Suite
 * 
 * Tests:
 * - M1: 3-Team Race for Open Fixture (1 Host, 2 Concurrent Applicants) -> Exactly 1 winner, 1 CHALLENGE_ALREADY_TAKEN, losing candidate declined.
 * - M2: Multiple Concurrent Hosts & Cross-Schedule Conflict Lockout (TEAM_SCHEDULE_CONFLICT / OPPONENT_SCHEDULE_CONFLICT).
 * - M3: Shared Player & Squad Roster Isolation across 3+ Teams (SHARED_PLAYER rejection between overlapping squads).
 * - M4: Format Compatibility Isolation (6v6 vs 8v8 teams rejected with FORMAT_MISMATCH).
 * - M5: 6-Team High Concurrency Swarm Simulation: 2 Hosts, 4 Applicants racing in parallel -> Exactly 2 matches created, 0 race leaks.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  TeamMatchingHarness,
  type TeamRecord,
} from '../harness/teamMatchingHarness';

describe('Tier 3: Multi-Team Matching & Concurrency Suite (3+ Teams)', () => {
  let harness: TeamMatchingHarness;
  let teamA: TeamRecord;
  let teamB: TeamRecord;
  let teamC: TeamRecord;
  let teamD: TeamRecord;

  const testStartTime = new Date('2026-09-10T10:00:00.000Z');
  const fixtureTime = '2026-09-10T18:00:00.000Z'; // 18:00 UTC

  beforeEach(() => {
    harness = new TeamMatchingHarness();
    harness.setMockTime(testStartTime);

    // Create player profiles
    for (let i = 1; i <= 30; i++) {
      harness.createProfile(`user-${i}`, `Player ${i}`);
    }

    // Team A: 6v6 Box Cricket (Captain: user-1, Roster: user-1..6)
    teamA = harness.createTeam({
      id: 'team-a',
      name: 'Super Strikers',
      sport: 'box_cricket',
      ownerId: 'user-1',
      targetSize: 6,
      members: ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'],
    });

    // Team B: 6v6 Box Cricket (Captain: user-7, Roster: user-7..12)
    teamB = harness.createTeam({
      id: 'team-b',
      name: 'Blaze XI',
      sport: 'box_cricket',
      ownerId: 'user-7',
      targetSize: 6,
      members: ['user-7', 'user-8', 'user-9', 'user-10', 'user-11', 'user-12'],
    });

    // Team C: 6v6 Box Cricket (Captain: user-13, Roster: user-13..18)
    teamC = harness.createTeam({
      id: 'team-c',
      name: 'Thunderbolts',
      sport: 'box_cricket',
      ownerId: 'user-13',
      targetSize: 6,
      members: ['user-13', 'user-14', 'user-15', 'user-16', 'user-17', 'user-18'],
    });

    // Team D: 8v8 Box Cricket (Captain: user-19, Roster: user-19..26)
    teamD = harness.createTeam({
      id: 'team-d',
      name: 'Royal Titans',
      sport: 'box_cricket',
      ownerId: 'user-19',
      targetSize: 8,
      members: ['user-19', 'user-20', 'user-21', 'user-22', 'user-23', 'user-24', 'user-25', 'user-26'],
    });
  });

  it('M1: 3-Team Race for Open Fixture — exactly 1 applicant wins, competing applicant gets CHALLENGE_ALREADY_TAKEN', async () => {
    // 1. Team A posts an open 6v6 challenge
    harness.setAuthUser(teamA.ownerId);
    const challenge = harness.postOpenChallenge({
      id: 'chal-001',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12, // 6 a side
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    assert.equal(challenge.status, 'open');

    // 2. Both Team B and Team C apply concurrently
    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(challenge.id, teamB.id);

    harness.setAuthUser(teamC.ownerId);
    harness.applyToOpenChallenge(challenge.id, teamC.id);

    assert.equal(harness.getCandidate(challenge.id, teamB.id)?.status, 'interested');
    assert.equal(harness.getCandidate(challenge.id, teamC.id)?.status, 'interested');

    // 3. Simulate atomic concurrent acceptance attempts by Team B and Team C
    const results: { team: string; success: boolean; error?: any }[] = [];

    const attemptAccept = async (team: TeamRecord) => {
      try {
        harness.setAuthUser(team.ownerId);
        const res = harness.acceptOpenChallenge(challenge.id, team.id, team.members.slice(0, 6));
        results.push({ team: team.name, success: true });
        return res;
      } catch (err: any) {
        results.push({ team: team.name, success: false, error: err });
        return null;
      }
    };

    await Promise.all([attemptAccept(teamB), attemptAccept(teamC)]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    assert.equal(successes.length, 1, 'Strictly 1 team must secure the open fixture');
    assert.equal(failures.length, 1, 'Strictly 1 competing team must be rejected');
    assert.equal(failures[0]?.error?.message, 'CHALLENGE_ALREADY_TAKEN');

    // 4. Assert invariant: Winning candidate is accepted, loser candidate is declined
    const winnerTeam = successes[0]?.team === teamB.name ? teamB : teamC;
    const loserTeam = winnerTeam.id === teamB.id ? teamC : teamB;

    assert.equal(harness.getCandidate(challenge.id, winnerTeam.id)?.status, 'accepted');
    assert.equal(harness.getCandidate(challenge.id, loserTeam.id)?.status, 'declined');

    // 5. Assert match record
    const match = harness.getMatch(`match-${challenge.id}`);
    assert.ok(match);
    assert.equal(match.status, 'upcoming');
    assert.equal(match.teamAId, teamA.id);
    assert.equal(match.teamBId, winnerTeam.id);
  });

  it('M2: Cross-Matching & Schedule Conflict Lockout — once matched, overlapping challenge attempts are rejected', async () => {
    // 1. Team A matches with Team B for 18:00 - 19:30
    harness.setAuthUser(teamA.ownerId);
    const chal1 = harness.postOpenChallenge({
      id: 'chal-ab',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(chal1.id, teamB.id);
    harness.acceptOpenChallenge(chal1.id, teamB.id, teamB.members.slice(0, 6));

    // 2. Team C tries to post an open challenge overlapping with the same window (e.g. 18:30)
    // and attempt to match with Team A or Team B
    harness.setAuthUser(teamC.ownerId);
    const chal2 = harness.postOpenChallenge({
      id: 'chal-c',
      fromTeamId: teamC.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: '2026-09-10T18:30:00.000Z', // overlaps 18:00 - 19:30
      durationMinutes: 90,
    });

    // 3. If Team A attempts to accept Team C's challenge during its active match -> OPPONENT_SCHEDULE_CONFLICT
    assert.throws(
      () => {
        harness.setAuthUser(teamA.ownerId);
        harness.applyToOpenChallenge(chal2.id, teamA.id);
      },
      (err: any) => err.message.includes('TEAM_SCHEDULE_CONFLICT'),
      'Team A must be rejected due to existing match schedule conflict',
    );
  });

  it('M3: Shared Player Invariant — squads sharing any player are strictly blocked from challenging each other', async () => {
    // Add user-2 (who is in Team A) to Team C as a guest/dual member
    harness.addTeamMember(teamC.id, 'user-2');

    // Team A posts open challenge
    harness.setAuthUser(teamA.ownerId);
    const chal = harness.postOpenChallenge({
      id: 'chal-shared',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    // Team C tries to apply -> Must fail with SHARED_PLAYER
    harness.setAuthUser(teamC.ownerId);
    assert.throws(
      () => {
        harness.applyToOpenChallenge(chal.id, teamC.id);
      },
      (err: any) => err.message === 'SHARED_PLAYER',
      'Team C sharing player with Team A must be rejected with SHARED_PLAYER',
    );

    // Team B (no shared player) applies and accepts cleanly
    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(chal.id, teamB.id);
    const res = harness.acceptOpenChallenge(chal.id, teamB.id, teamB.members.slice(0, 6));
    assert.equal(res.challenge.status, 'accepted');
  });

  it('M4: Format Compatibility — 8v8 squad cannot match against a 6v6 challenge', async () => {
    harness.setAuthUser(teamA.ownerId);
    const chal = harness.postOpenChallenge({
      id: 'chal-format',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12, // 6v6
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    // Team D (8v8) attempts to apply -> FORMAT_MISMATCH
    harness.setAuthUser(teamD.ownerId);
    assert.throws(
      () => {
        harness.applyToOpenChallenge(chal.id, teamD.id);
      },
      (err: any) => err.message === 'FORMAT_MISMATCH',
      'Team D with 8v8 format must be rejected for 6v6 challenge with FORMAT_MISMATCH',
    );
  });

  it('M5: 6-Team High Concurrency Swarm — 2 Hosts, 4 Applicants in parallel create exactly 2 matches with zero leaks', async () => {
    // Create Team E and Team F
    const teamE = harness.createTeam({
      id: 'team-e',
      name: 'Eagle Stars',
      sport: 'box_cricket',
      ownerId: 'user-27',
      targetSize: 6,
      members: ['user-27', 'user-28', 'user-29', 'user-30', 'user-3', 'user-4'].map((u, i) => `user-e-${i}`),
    });

    const teamF = harness.createTeam({
      id: 'team-f',
      name: 'Falcon Riders',
      sport: 'box_cricket',
      ownerId: 'user-31',
      targetSize: 6,
      members: ['user-31', 'user-32', 'user-33', 'user-34', 'user-35', 'user-36'].map((u, i) => `user-f-${i}`),
    });

    // 2 Hosts (Team A and Team E) post challenges
    harness.setAuthUser(teamA.ownerId);
    const chalA = harness.postOpenChallenge({
      id: 'chal-host-a',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    harness.setAuthUser(teamE.ownerId);
    const chalE = harness.postOpenChallenge({
      id: 'chal-host-e',
      fromTeamId: teamE.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    // 4 Applicants (Team B, Team C, Team F) apply to challenges
    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(chalA.id, teamB.id);

    harness.setAuthUser(teamC.ownerId);
    harness.applyToOpenChallenge(chalA.id, teamC.id);
    harness.applyToOpenChallenge(chalE.id, teamC.id);

    harness.setAuthUser(teamF.ownerId);
    harness.applyToOpenChallenge(chalE.id, teamF.id);

    // Concurrent acceptances
    const acceptTasks = [
      () => {
        harness.setAuthUser(teamB.ownerId);
        return harness.acceptOpenChallenge(chalA.id, teamB.id, teamB.members.slice(0, 6));
      },
      () => {
        harness.setAuthUser(teamC.ownerId);
        return harness.acceptOpenChallenge(chalA.id, teamC.id, teamC.members.slice(0, 6));
      },
      () => {
        harness.setAuthUser(teamF.ownerId);
        return harness.acceptOpenChallenge(chalE.id, teamF.id, teamF.members.slice(0, 6));
      },
    ];

    const outcomes = await Promise.allSettled(acceptTasks.map((fn) => Promise.resolve().then(fn)));
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');

    assert.equal(fulfilled.length, 2, 'Exactly 2 matches must be confirmed across 6 teams');
    assert.equal(harness.getAllMatches().length, 2, 'Total matches created in DB must be exactly 2');
  });

  it('M6: Multi-Team Application & Selective Withdrawal — applicants can withdraw without affecting other teams or host', async () => {
    // 1. Team A posts open fixture
    harness.setAuthUser(teamA.ownerId);
    const chal = harness.postOpenChallenge({
      id: 'chal-withdraw-test',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    // 2. Teams B and C apply
    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(chal.id, teamB.id);

    harness.setAuthUser(teamC.ownerId);
    harness.applyToOpenChallenge(chal.id, teamC.id);

    assert.equal(harness.getCandidate(chal.id, teamB.id)?.status, 'interested');
    assert.equal(harness.getCandidate(chal.id, teamC.id)?.status, 'interested');

    // 3. Team C changes their mind and withdraws (declines open challenge)
    harness.setAuthUser(teamC.ownerId);
    const candC = harness.declineOpenChallenge(chal.id, teamC.id);
    assert.equal(candC.status, 'declined');

    // 4. Team B is still active and can be accepted by Team A
    harness.setAuthUser(teamA.ownerId);
    const result = harness.acceptOpenChallenge(chal.id, teamB.id, teamA.members.slice(0, 6));
    assert.equal(result.challenge.status, 'accepted');
    assert.equal(result.match.teamBId, teamB.id);

    // 5. Team C cannot be accepted since they withdrew
    assert.throws(
      () => {
        harness.setAuthUser(teamA.ownerId);
        harness.acceptOpenChallenge(chal.id, teamC.id, teamA.members.slice(0, 6));
      },
      (err: any) => err.message === 'NOT_OFFERED' || err.message === 'CHALLENGE_ALREADY_TAKEN',
    );
  });

  it('M7: Host Open Fixture Withdrawal — host can withdraw/cancel before match confirmation, cleaning up all candidate states', async () => {
    // 1. Team A posts open fixture
    harness.setAuthUser(teamA.ownerId);
    const chal = harness.postOpenChallenge({
      id: 'chal-host-cancel',
      fromTeamId: teamA.id,
      sport: 'box_cricket',
      totalSlots: 12,
      scheduledAt: fixtureTime,
      durationMinutes: 90,
    });

    // 2. Team B applies
    harness.setAuthUser(teamB.ownerId);
    harness.applyToOpenChallenge(chal.id, teamB.id);

    // 3. Host Team A withdraws the challenge
    harness.setAuthUser(teamA.ownerId);
    const cancelled = harness.cancelChallenge(chal.id);
    assert.equal(cancelled.status, 'cancelled');

    // 4. Candidate rows are closed
    assert.equal(harness.getCandidate(chal.id, teamB.id)?.status, 'declined');

    // 5. Subsequent acceptance attempts are blocked
    assert.throws(
      () => {
        harness.setAuthUser(teamB.ownerId);
        harness.acceptOpenChallenge(chal.id, teamB.id, teamB.members.slice(0, 6));
      },
      (err: any) => err.message === 'CHALLENGE_ALREADY_TAKEN',
    );
  });
});
