import { z } from 'zod';

import type { Database, TeamRole } from '@shared/types/database.types';

export type Team = Database['public']['Tables']['teams']['Row'];
export type TeamMember = Database['public']['Tables']['team_members']['Row'];

/** A roster entry with the member's public profile attached. */
export interface TeamMemberWithProfile extends TeamMember {
  profile: { full_name: string; area_name: string | null } | null;
}

export const CreateTeamSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  sport: z.enum(['box_cricket', 'badminton']),
});

export type CreateTeamForm = z.infer<typeof CreateTeamSchema>;

export const TeamInviteCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6}$/, 'Enter the 6-character code'),
});

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  owner: 'Owner',
  member: 'Member',
};
