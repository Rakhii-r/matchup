/**
 * Application error model. Every error surfaced to the UI is an AppError with a
 * user-safe `message` and a stable `code`. Raw Supabase/Postgres errors are mapped
 * into these via `toAppError` so we never leak internals to users.
 */
export type AppErrorCode =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'unknown';

export class AppError extends Error {
  readonly code: AppErrorCode;
  override readonly cause?: unknown;

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

interface SupabaseLikeError {
  message?: string;
  code?: string;
  status?: number;
}

const USER_MESSAGE: Record<AppErrorCode, string> = {
  network: 'Network problem. Check your connection and try again.',
  unauthorized: 'Please sign in to continue.',
  forbidden: "You don't have permission to do that.",
  not_found: "We couldn't find what you were looking for.",
  conflict: 'This time slot or team already has a match scheduled. Please choose a different time or date.',
  validation: 'Some details are invalid. Please review and try again.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  unknown: 'Something went wrong. Please try again.',
};

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const e = (error ?? {}) as SupabaseLikeError;
  const status = e.status;
  const raw = (e.message ?? '').toLowerCase();

  // A mobile build can be updated before its accompanying Supabase migration.
  // Make that deployment mismatch actionable instead of hiding it behind the
  // generic unknown-error message.
  if (
    e.code === 'PGRST204' ||
    (raw.includes('match_name') && (raw.includes('column') || raw.includes('schema cache')))
  ) {
    return new AppError(
      'unknown',
      'The match database update is not installed yet. Please apply the latest Supabase migrations.',
      error,
    );
  }

  if (raw.includes('team_schedule_conflict') || raw.includes('player_schedule_conflict') || raw.includes('opponent_schedule_conflict')) {
    return new AppError(
      'conflict',
      'This time slot already has an active match or open challenge scheduled. Please pick a different time or date.',
      error,
    );
  }

  let code: AppErrorCode = 'unknown';
  if (raw.includes('network') || raw.includes('fetch')) code = 'network';
  // GoTrue returns HTTP 403 for expired/invalid OTP tokens too (error_code: 'otp_expired').
  // That is a user input problem, not an authorisation failure — must be checked before
  // the generic 403 => forbidden mapping below, or it renders as "no permission".
  else if (e.code === 'otp_expired' || e.code === 'otp_disabled' || raw.includes('token has expired') || raw.includes('otp'))
    code = 'validation';
  else if (status === 401) code = 'unauthorized';
  else if (status === 403 || e.code === '42501') code = 'forbidden'; // 42501 = RLS denial
  else if (status === 404 || e.code === 'PGRST116') code = 'not_found';
  else if (status === 409 || e.code === '23505') code = 'conflict'; // unique_violation
  else if (status === 422 || e.code === '23514') code = 'validation';
  else if (status === 429) code = 'rate_limited';

  return new AppError(code, USER_MESSAGE[code], error);
}
