import { z } from 'zod';

/** Fixed reasons keep the report queue triageable for moderators. */
export const REPORT_REASONS = [
  'No-show',
  'Abusive behaviour',
  'Fake profile',
  'Inappropriate messages',
  'Other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const ReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(280).optional(),
});
