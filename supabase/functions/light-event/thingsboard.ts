export interface ClaimedEvent {
  event_id: string;
  event: 'FOUR' | 'SIX' | 'WICKET' | 'TEST';
  expires_at: string;
  device_token: string;
}

interface ThingsBoardConfig {
  host: string;
  devices?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = { FOUR: '4', SIX: '6', WICKET: 'out', TEST: '4' } as const;
const TELEMETRY_TIMEOUT_MS = 3000;

async function post(
  url: string, body: unknown, deadline: number, authorization?: string,
): Promise<Response> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('expired');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authorization) headers['X-Authorization'] = authorization;
  return await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(remaining),
  });
}

async function sendCommand(
  ev: ClaimedEvent, deviceId: string, expires: number, config: ThingsBoardConfig,
): Promise<string | null> {
  if (!DEVICE_ID.test(deviceId)) return 'Invalid ThingsBoard RPC device ID';
  if (new URL(config.host).protocol !== 'https:') return 'ThingsBoard RPC requires HTTPS';

  let authorization: string;
  if (config.apiKey) {
    authorization = `ApiKey ${config.apiKey}`;
  } else {
    if (!config.username || !config.password) return 'ThingsBoard RPC credentials missing';
    const login = await post(`${config.host}/api/auth/login`, {
      username: config.username, password: config.password,
    }, Math.min(expires, Date.now() + 3000));
    if (!login.ok) return `ThingsBoard login returned HTTP ${login.status}`;
    const { token } = await login.json();
    if (typeof token !== 'string' || !token) return 'ThingsBoard login did not return an access token';
    authorization = `Bearer ${token}`;
  }

  // The working dashboard uses a non-persistent command with a five-second timeout.
  // A lost HTTP response can follow a successful blink, so never resend this RPC.
  const deadline = Math.min(expires, Date.now() + 5000);
  const res = await post(`${config.host}/api/rpc/oneway/${deviceId}`, {
    method: 'setState', params: STATES[ev.event], persistent: false, expirationTime: deadline,
  }, deadline, authorization);
  return res.ok ? null : `ThingsBoard RPC returned HTTP ${res.status}`;
}

/** Returns null when ThingsBoard accepted the event. Never include credentials in errors. */
export async function sendLightEvent(ev: ClaimedEvent, config: ThingsBoardConfig): Promise<string | null> {
  const expires = Date.parse(ev.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) return 'expired';

  if (config.devices !== undefined) {
    let devices: Record<string, unknown>;
    try {
      devices = JSON.parse(config.devices);
      if (devices === null || typeof devices !== 'object' || Array.isArray(devices)) {
        return 'Invalid TB_RPC_DEVICES configuration';
      }
    } catch {
      return 'Invalid TB_RPC_DEVICES configuration';
    }
    if (Object.hasOwn(devices, ev.device_token)) {
      const id = devices[ev.device_token];
      if (typeof id !== 'string') return 'Invalid ThingsBoard RPC device ID';
      try {
        return await sendCommand(ev, id, expires, config);
      } catch {
        return Date.now() >= expires ? 'expired' : 'network error contacting ThingsBoard RPC';
      }
    }
  }

  // Previously linked telemetry controllers deduplicate this payload by event_id.
  const url = `${config.host}/api/v1/${encodeURIComponent(ev.device_token)}/telemetry`;
  const payload = { event: ev.event, event_id: ev.event_id, expires_at: Math.floor(expires / 1000) };
  let failure = 'network error contacting ThingsBoard telemetry';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post(url, payload, Math.min(expires, Date.now() + TELEMETRY_TIMEOUT_MS));
      if (res.ok) return null;
      failure = `thingsboard ${res.status}`;
    } catch {
      failure = 'network error contacting ThingsBoard telemetry';
    }
    if (Date.now() + TELEMETRY_TIMEOUT_MS >= expires) break;
  }
  return failure;
}
