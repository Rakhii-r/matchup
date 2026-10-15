/**
 * sixfour24 — Supabase load test (k6)
 *
 * Two independent scenarios:
 *
 *  1. discovery_read   — safe to run at full target scale against PRODUCTION.
 *                        Hits only read-only RPCs (list_open_challenges_nearby,
 *                        nearby_matches, rank_challenge_candidates). No writes,
 *                        no notifications fire, no data is created.
 *
 *  2. write_flow       — DO NOT run this at 1000-5000 VU against production.
 *                        Keep this scenario's VU count small (10-50) and point
 *                        it only at accounts/squads you've flagged as test data
 *                        so you can find and delete what it creates afterward
 *                        (its rows have match_name = 'k6 load test').
 *
 * ---------------------------------------------------------------------------
 * SETUP — fill these in before running
 * ---------------------------------------------------------------------------
 *  SUPABASE_URL       e.g. https://izqknyzmeyiowbwmcfes.supabase.co
 *  SUPABASE_ANON_KEY  the app's public anon key (Settings > API in Supabase)
 *  TEST_USER_JWTS     a JSON array of valid user JWTs to round-robin auth
 *                      with, for endpoints that require an authenticated
 *                      caller (list_open_challenges_nearby, rank_challenge_
 *                      candidates). Generate these from real or dedicated
 *                      test accounts — do NOT use the service_role key here,
 *                      it bypasses RLS and isn't representative of real load.
 *  TEST_TEAM_IDS       (write_flow only) team IDs you own and can safely
 *                      generate challenges/matches for.
 *
 * Run:
 *   k6 run \
 *     -e SUPABASE_URL=https://izqknyzmeyiowbwmcfes.supabase.co \
 *     -e SUPABASE_ANON_KEY=xxxx \
 *     -e TEST_USER_JWTS='["jwt1","jwt2","jwt3"]' \
 *     sixfour24_load_test.js
 * ---------------------------------------------------------------------------
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ---- config -----------------------------------------------------------

const SUPABASE_URL = __ENV.SUPABASE_URL || 'https://izqknyzmeyiowbwmcfes.supabase.co';
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6cWtueXptZXlpb3did21jZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTU4MDYsImV4cCI6MjA5Nzg3MTgwNn0.7l6vJ4QioeulbCHs_s9K6NlmXOr49A9EH_0NmMZeRhk';

// Both scenarios enabled: this is a test project, and 'write_flow' is
// capped low (see options.scenarios.write_flow) since it cycles only the
// 2 real squads that exist right now (team / Rahul test, both 4v4).
const SCENARIOS_TO_RUN = ['discovery_read', 'write_flow'];

const jwts = new SharedArray('jwts', function () {
  try {
    return JSON.parse(__ENV.TEST_USER_JWTS || '[]');
  } catch (e) {
    return [];
  }
});

const testTeamIds = new SharedArray('teamIds', function () {
  try {
    // Defaults to the 2 real 4v4 test squads in MATCHUP. Override with
    // -e TEST_TEAM_IDS='[...]' if you add more. ORDER MATTERS for write_flow:
    // TEST_USER_JWTS[i] must belong to the owner of TEST_TEAM_IDS[i]
    // (346d9aab… owns "team", cd851801… owns "Rahul test").
    return JSON.parse(
      __ENV.TEST_TEAM_IDS ||
        '["71dffe8f-dc59-4667-9a07-e9b76511c57d","5150d357-3ab6-4945-84c3-17a7da4479c4"]'
    );
  } catch (e) {
    return [];
  }
});

function authHeaders(useUserJwt) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (useUserJwt && jwts.length > 0) {
    const jwt = jwts[Math.floor(Math.random() * jwts.length)];
    headers['Authorization'] = `Bearer ${jwt}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

// ---- custom metrics -----------------------------------------------------

const rpcErrorRate = new Rate('rpc_error_rate');
const rpcDuration = new Trend('rpc_duration_ms', true);

// ---- scenarios ------------------------------------------------------------

export const options = {
  scenarios: {
    ...(SCENARIOS_TO_RUN.includes('discovery_read') && {
      discovery_read: {
        executor: 'ramping-vus',
        exec: 'discoveryRead',
        startVUs: 0,
        // TEMP (23 Sep 2026): capped at 1000 while scaling up in steps.
        // Full ramp was 200 → 1000 → 3000 → 5000 over 18m.
        stages: [
          { duration: '1m', target: 200 },   // warm-up
          { duration: '2m', target: 500 },
          { duration: '3m', target: 1000 },  // hold at cap
          { duration: '1m', target: 0 },     // ramp down
        ],
      },
    }),
    ...(SCENARIOS_TO_RUN.includes('write_flow') && {
      // A fixed, slow post rate rather than a VU ramp: post_open_challenge
      // cancels the posting team's previous open challenge, so with only 2
      // squads more concurrency just measures supersede churn.
      write_flow: {
        executor: 'constant-arrival-rate',
        exec: 'writeFlow',
        rate: 6,
        timeUnit: '1m',          // 1 post every 10s
        duration: '7m',
        preAllocatedVUs: 2,
        maxVUs: 4,
      },
    }),
  },
  thresholds: {
    rpc_error_rate: ['rate<0.02'],       // fail the run if >2% of RPC calls error
    http_req_duration: ['p(95)<800'],    // 95th percentile under 800ms
    rpc_duration_ms: ['p(99)<2000'],
  },
};

// ---- scenario 1: read-only discovery / matchmaking reads ------------------

export function discoveryRead() {
  const rpcs = [
    {
      name: 'nearby_matches',
      // authenticated-only since 20260907134158 revoked anon execute
      body: { in_lat: 17.385 + (Math.random() - 0.5) * 0.2, in_lng: 78.4867 + (Math.random() - 0.5) * 0.2, in_radius_m: 15000 },
      useUserJwt: true,
    },
    {
      name: 'list_open_challenges_nearby',
      // pass a format to mirror in-app strict behaviour; omit for the
      // deliberately relaxed anonymous-discovery path
      body: { in_lat: 17.385, in_lng: 78.4867, in_radius_m: 15000, in_team_size: 4 },
      useUserJwt: true,
    },
    {
      name: 'rank_challenge_candidates',
      // The function does not filter on challenge status, so a cancelled
      // challenge still runs the full eligibility query. It returns no rows
      // while the only 2 squads share members.
      body: { in_challenge_id: '3d7c9297-1d2c-4a58-8e0e-0ca0f468a1a1' },
      useUserJwt: true,
    },
  ];

  const pick = rpcs[Math.floor(Math.random() * rpcs.length)];
  const url = `${SUPABASE_URL}/rest/v1/rpc/${pick.name}`;
  const res = http.post(url, JSON.stringify(pick.body), {
    headers: authHeaders(pick.useUserJwt),
    tags: { rpc: pick.name },
  });

  rpcDuration.add(res.timings.duration, { rpc: pick.name });
  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'no error body': (r) => {
      try {
        const j = JSON.parse(r.body);
        return !j.error;
      } catch (e) {
        return true;
      }
    },
  });
  rpcErrorRate.add(!ok);

  sleep(Math.random() * 1.5 + 0.5); // 0.5-2s think time between calls
}

// ---- scenario 2: write flow (small scale, test data only) -----------------

// Team vs Team, post side only. Each iteration picks a squad, has its OWNER
// post an open 4 v 4 challenge (post_open_challenge requires the owner), then
// ranks it. There is no accept step: the 2 test squads share players, so
// accept_open_challenge would always refuse with SHARED_PLAYER, and the
// ranking offers the fixture to nobody — which also means no push is sent.
// Rows are tagged with WRITE_FLOW_TAG in match_name so they can be found and
// deleted afterwards.
const WRITE_FLOW_TAG = 'k6 load test';

function ownerHeaders(i) {
  return {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwts[i]}`,
  };
}

export function writeFlow() {
  const n = Math.min(testTeamIds.length, jwts.length);
  if (n === 0) {
    console.warn('write_flow needs TEST_TEAM_IDS and matching TEST_USER_JWTS — skipping iteration');
    return;
  }

  const i = Math.floor(Math.random() * n);
  const headers = ownerHeaders(i);

  // 3 days out plus jitter, so a post never trips SCHEDULE_IN_PAST
  const start = new Date(Date.now() + 3 * 86400000 + Math.floor(Math.random() * 86400000));
  const end = new Date(start.getTime() + 2 * 3600000);

  const postRes = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/post_open_challenge`,
    JSON.stringify({
      in_from_team_id: testTeamIds[i],
      in_match_name: WRITE_FLOW_TAG,
      in_area_name: WRITE_FLOW_TAG,
      in_scheduled_at: start.toISOString(),
      in_end_time: end.toISOString(),
      in_total_slots: 8,             // 4 v 4, the squads' declared format
      in_message: `${WRITE_FLOW_TAG} - safe to delete`,
      in_lat: 17.385,
      in_lng: 78.4867,
    }),
    { headers, tags: { rpc: 'post_open_challenge' } }
  );
  rpcDuration.add(postRes.timings.duration, { rpc: 'post_open_challenge' });
  const posted = check(postRes, { 'challenge posted': (r) => r.status === 200 });
  rpcErrorRate.add(!posted);
  if (!posted) {
    console.warn(`post_open_challenge ${postRes.status}: ${postRes.body}`);
    return;
  }

  let challengeId = null;
  try {
    challengeId = JSON.parse(postRes.body).id;
  } catch (e) {
    console.warn(`post_open_challenge returned unparseable body: ${postRes.body}`);
  }
  if (!challengeId) {
    rpcErrorRate.add(true);
    return;
  }

  const rankRes = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/rank_challenge_candidates`,
    JSON.stringify({ in_challenge_id: challengeId }),
    { headers, tags: { rpc: 'rank_challenge_candidates' } }
  );
  rpcDuration.add(rankRes.timings.duration, { rpc: 'rank_challenge_candidates' });
  rpcErrorRate.add(!check(rankRes, { 'challenge ranked': (r) => r.status === 200 }));
}
