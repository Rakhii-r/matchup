import { z } from 'zod';

export const SportEnum = z.enum(['box_cricket', 'badminton']);

/** Validation for the create-profile form. Kept short to avoid sign-up drop-off. */
export const CreateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your name').max(60),
  areaName: z.string().trim().min(2, 'Please enter your area').max(80),
  sportPref: z.array(SportEnum).min(1, 'Pick at least one sport'),
});

export type CreateProfileForm = z.infer<typeof CreateProfileSchema>;
