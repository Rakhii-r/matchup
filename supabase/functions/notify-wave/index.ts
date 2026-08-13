/**
 * notify-wave — drains public.notification_jobs and sends via the Expo Push API.
 *
 * Invoked by pg_cron (see 20260808084324_push_notifications.sql), which only
 * pokes this function when at least one job is pending. It can also be called
 * by hand with the service role key for testing.
 *
 * Contract with the database:
 *   claim_notification_jobs()  atomically flips pending -> processing and hands
 *                              back each job with the recipient's push tokens.
 *   This function then writes the terminal state (sent | failed) itself, using
 *   the service role, which bypasses RLS.
 *
 * If this function dies mid-run, reap_stuck_notification_jobs (cron, 5 min)
 * returns anything left in 'processing' to 'pending'. Jobs stop retrying after
 * 5 attempts, so a permanently bad recipient cannot loop forever.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;
/** Expo rejects requests carrying more than 100 messages. */
const EXPO_CHUNK = 100;

interface ClaimedJob {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  tokens: string[] | null;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** One Expo message, tagged with the job it belongs to so tickets can be mapped back. */
interface OutboundMessage {
  jobId: string;
  token: string;
  payload: Record<string, unknown>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Expo tokens look like ExponentPushToken[xxx] or ExpoPushToken[xxx]. Anything
 * else is a stale raw FCM token from an older client and will only ever 400.
 */
function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

async function sendChunk(
  messages: OutboundMessage[],
  accessToken: string | undefined,
): Promise<Map<number, ExpoTicket>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  // Only needed if the Expo project has "enhanced security for push" enabled.
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages.map((m) => m.payload)),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo push API ${response.status}: ${text.slice(0, 400)}`);
  }

  const parsed = (await response.json()) as { data?: ExpoTicket[]; errors?: unknown };
  const tickets = parsed.data;
  if (!Array.isArray(tickets)) {
    throw new Error(`Expo push API returned no ticket array: ${JSON.stringify(parsed).slice(0, 400)}`);
  }

  // Expo returns tickets positionally, one per message sent.
  const byIndex = new Map<number, ExpoTicket>();
  tickets.forEach((ticket, index) => byIndex.set(index, ticket));
  return byIndex;
}

/**
 * A token Expo reports as DeviceNotRegistered will never work again — the app
 * was uninstalled or the token was rotated. Deleting it keeps the devices table
 * from accumulating dead rows that slow every future fan-out.
 */
async function dropDeadTokens(supabase: SupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const { error } = await supabase.from('devices').delete().in('fcm_token', tokens);
  if (error) console.error('notify-wave: failed to prune dead tokens', error.message);
}

async function markJobs(
  supabase: SupabaseClient,
  ids: string[],
  status: 'sent' | 'failed',
  lastError: string | null,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('notification_jobs')
    .update({ status, processed_at: new Date().toISOString(), last_error: lastError })
    .in('id', ids);
  if (error) console.error(`notify-wave: failed to mark ${status}`, error.message);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? undefined;

  if (!supabaseUrl || !serviceKey) {
    console.error('notify-wave: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
    return new Response(JSON.stringify({ error: 'Function is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // The caller must present the service role key. The cron dispatcher sends it;
  // nothing else should be able to drain the queue.
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: jobs, error: claimError } = await supabase.rpc('claim_notification_jobs', {
    in_limit: BATCH_SIZE,
  });

  if (claimError) {
    console.error('notify-wave: claim failed', claimError.message);
    return new Response(JSON.stringify({ error: 'Could not claim jobs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];
  if (claimed.length === 0) {
    return new Response(JSON.stringify({ claimed: 0, sent: 0, failed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages: OutboundMessage[] = [];
  // A recipient with no registered device is not an error and must not be
  // retried five times — it is simply nothing to deliver.
  const noDevice: string[] = [];

  for (const job of claimed) {
    const tokens = (job.tokens ?? []).filter(isExpoToken);
    if (tokens.length === 0) {
      noDevice.push(job.id);
      continue;
    }
    for (const token of tokens) {
      messages.push({
        jobId: job.id,
        token,
        payload: {
          to: token,
          title: job.title,
          body: job.body,
          data: job.data ?? {},
          sound: 'default',
          channelId: 'default',
          priority: 'high',
        },
      });
    }
  }

  await markJobs(supabase, noDevice, 'sent', 'no registered device');

  // A job counts as sent if at least one of the user's devices accepted it.
  const delivered = new Set<string>();
  const errorByJob = new Map<string, string>();
  const deadTokens: string[] = [];
  // Jobs whose whole chunk failed transiently. Deliberately left in
  // 'processing' so the reaper returns them to 'pending' for a real retry,
  // rather than being burned as a permanent failure.
  const retryable = new Set<string>();

  for (const group of chunk(messages, EXPO_CHUNK)) {
    let tickets: Map<number, ExpoTicket>;
    try {
      tickets = await sendChunk(group, expoAccessToken);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      console.error('notify-wave: chunk send failed', reason);
      for (const message of group) retryable.add(message.jobId);
      continue;
    }

    group.forEach((message, index) => {
      const ticket = tickets.get(index);
      if (!ticket) {
        errorByJob.set(message.jobId, 'no ticket returned');
        return;
      }
      if (ticket.status === 'ok') {
        delivered.add(message.jobId);
        return;
      }
      errorByJob.set(message.jobId, ticket.message ?? ticket.details?.error ?? 'unknown Expo error');
      if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(message.token);
    });
  }

  await dropDeadTokens(supabase, deadTokens);

  const sentIds = [...delivered];
  await markJobs(supabase, sentIds, 'sent', null);

  // Rejected by Expo for a reason specific to this job — a permanent failure.
  // Chunk-level (retryable) failures are excluded and left for the reaper.
  const failedIds = [...new Set(messages.map((m) => m.jobId))].filter(
    (id) => !delivered.has(id) && !retryable.has(id),
  );

  // Group by error text so one UPDATE covers every job that failed the same way.
  const byError = new Map<string, string[]>();
  for (const id of failedIds) {
    const reason = errorByJob.get(id) ?? 'delivery failed';
    const bucket = byError.get(reason);
    if (bucket) bucket.push(id);
    else byError.set(reason, [id]);
  }
  for (const [reason, ids] of byError) {
    await markJobs(supabase, ids, 'failed', reason);
  }

  const summary = {
    claimed: claimed.length,
    sent: sentIds.length + noDevice.length,
    failed: failedIds.length,
    retrying: retryable.size,
  };
  console.log('notify-wave', JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
