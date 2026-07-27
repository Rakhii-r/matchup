import { z } from 'zod';

/**
 * India-first phone handling. Users typically type a 10-digit number; we normalise to
 * E.164 for Supabase. Accepts an optional +91 / 0 prefix and strips spaces.
 */
const TenDigit = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

export function normaliseIndianPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  const local = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  const trimmed = local.startsWith('0') ? local.slice(1) : local;
  const result = TenDigit.safeParse(trimmed);
  return result.success ? `+91${result.data}` : null;
}

export const OtpSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
