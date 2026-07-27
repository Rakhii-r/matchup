import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * Typed, validated runtime configuration.
 * Values come from app.config.ts `extra` (production / EAS builds) and from
 * EXPO_PUBLIC_* env vars (Expo Go dev — Metro injects these into process.env).
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function readEnv(extraKey: string, publicKey: string): unknown {
  const fromExtra = extra[extraKey];
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  return process.env[publicKey];
}

const EnvSchema = z.object({
  supabaseUrl: z.string().url('EXPO_PUBLIC_SUPABASE_URL must be a valid URL'),
  supabaseAnonKey: z.string().min(1, 'EXPO_PUBLIC_SUPABASE_ANON_KEY is required'),
  posthogKey: z.string().optional().default(''),
  posthogHost: z.string().url().optional().default('https://app.posthog.com'),
  sentryDsn: z.string().optional().default(''),
  appEnv: z.enum(['development', 'staging', 'production']).default('development'),
});

const parsed = EnvSchema.safeParse({
  supabaseUrl: readEnv('supabaseUrl', 'EXPO_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: readEnv('supabaseAnonKey', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  posthogKey: readEnv('posthogKey', 'EXPO_PUBLIC_POSTHOG_KEY'),
  posthogHost: readEnv('posthogHost', 'EXPO_PUBLIC_POSTHOG_HOST'),
  sentryDsn: readEnv('sentryDsn', 'EXPO_PUBLIC_SENTRY_DSN'),
  appEnv: readEnv('appEnv', 'EXPO_PUBLIC_APP_ENV'),
});

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(
    `Invalid environment configuration. Check your .env file:\n${issues}\n` +
      'Copy .env.example to .env and fill in the values.',
  );
}

export const env = parsed.data;
export const isProd = env.appEnv === 'production';
export const isDev = env.appEnv === 'development';
