/**
 * light-event: forwards one court-lights event to ThingsBoard.
 *
 * Called by public.dispatch_light_event (pg_net) with { "event_id": "..." } and
 * `Authorization: Bearer <vault light_event_secret>`. JWT verification is off;
 * the caller check below is the guard. Design: docs/PHASE2_LIGHTS_DESIGN.md.
 *
 * Contract with the database:
 *   verify_light_event_caller(token)  compares the bearer with the vault row, so
 *                                     there is exactly one copy of the secret.
 *   claim_light_event(id)             queued -> sending, re-checks expiry and the
 *                                     slot, returns the device token. No row =
 *                                     do not fire (it has already recorded why).
 *   finish_light_event(id, ok, err)   sent | failed.
 *
 * The claimed court selects a dashboard-compatible RPC or a telemetry controller.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { type ClaimedEvent, sendLightEvent } from './thingsboard.ts';

const DEFAULT_TB_HOST = 'https://thingsboard.cloud';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const tbHost = (Deno.env.get('TB_HOST') ?? DEFAULT_TB_HOST).replace(/\/+$/, '');

  if (!supabaseUrl || !serviceKey) {
    console.error('light-event: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return json(500, { error: 'Function is not configured' });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // A rejected caller must be loud: a silent 403 is what kept notify-wave dead
  // for three weeks.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: callerOk, error: verifyError } = await supabase.rpc('verify_light_event_caller', {
    in_token: bearer,
  });
  if (verifyError) {
    console.error('light-event: caller check failed', verifyError.message);
    return json(500, { error: 'Could not verify caller' });
  }
  if (callerOk !== true) {
    console.error('light-event: REJECTED caller (bearer does not match vault light_event_secret)');
    return json(403, { error: 'Forbidden' });
  }

  let eventId: unknown;
  try {
    eventId = ((await req.json()) as { event_id?: unknown }).event_id;
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return json(400, { error: 'event_id is required' });
  }

  const { data: claimed, error: claimError } = await supabase.rpc('claim_light_event', {
    in_event_id: eventId,
  });
  if (claimError) {
    console.error('light-event: claim failed', claimError.message);
    return json(500, { error: 'Could not claim event' });
  }
  const ev = ((claimed ?? []) as ClaimedEvent[])[0];
  if (!ev) {
    // Expired, slot over, device off or already handled; the row says which.
    return json(200, { sent: false });
  }

  const failure = await sendLightEvent(ev, {
    host: tbHost,
    devices: Deno.env.get('TB_RPC_DEVICES'),
    apiKey: Deno.env.get('TB_API_KEY'),
    username: Deno.env.get('TB_USERNAME'),
    password: Deno.env.get('TB_PASSWORD'),
  });

  const { error: finishError } = await supabase.rpc('finish_light_event', {
    in_event_id: ev.event_id,
    in_ok: failure === null,
    in_error: failure,
  });
  if (finishError) console.error('light-event: finish failed', finishError.message);
  if (failure !== null) console.error(`light-event: ${ev.event_id} failed: ${failure}`);

  return json(200, { sent: failure === null });
});
