/**
 * generate_test_jwts.js
 *
 * Signs valid Supabase-compatible access tokens locally for a list of
 * user ids, bypassing phone OTP / email magic-link entirely. This only
 * works because you hold the project's JWT secret (Settings > API > JWT
 * Settings) — never commit that secret or paste it into chat/logs.
 *
 * Usage:
 *   npm install jsonwebtoken
 *   SUPABASE_JWT_SECRET=<your secret> node generate_test_jwts.js \
 *     346d9aab-7e96-47a1-b3e5-39900ad9b25e \
 *     cd851801-699b-43c1-b13b-e5bb8a99b749
 *
 * Prints a JSON array of JWTs, one per user id given, in the same order —
 * ready to paste into -e TEST_USER_JWTS='[...]'
 */

const jwt = require('jsonwebtoken');

const SECRET = process.env.SUPABASE_JWT_SECRET;
const EXPIRES_IN_SECONDS = parseInt(process.env.JWT_TTL_SECONDS || '3600', 10);

if (!SECRET) {
  console.error('Set SUPABASE_JWT_SECRET (Settings > API > JWT Settings in your Supabase dashboard).');
  process.exit(1);
}

const userIds = process.argv.slice(2);
if (userIds.length === 0) {
  console.error('Pass one or more user ids as arguments.');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);

const tokens = userIds.map((userId) => {
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: userId,
    iat: now,
    exp: now + EXPIRES_IN_SECONDS,
    // Matches the shape GoTrue issues; PostgREST/RLS only care about
    // aud, role, sub and exp, but keeping this close to real tokens
    // avoids surprises if any RPC inspects app_metadata.
    app_metadata: {},
    user_metadata: {},
    iss: 'supabase',
  };
  return jwt.sign(payload, SECRET, { algorithm: 'HS256' });
});

console.log(JSON.stringify(tokens));
