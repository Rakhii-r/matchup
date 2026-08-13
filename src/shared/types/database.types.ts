/**
 * Supabase schema types for the Phase 1 MatchUp database.
 *
 * This file is hand-written to match supabase/migrations/0001_phase1_schema.sql so the
 * app is type-safe today. Once the Supabase CLI is set up, regenerate it with:
 *   npm run db:types
 * (which runs `supabase gen types typescript --local`).
 */

export type Sport = 'box_cricket' | 'badminton';
export type MatchStatus = 'open' | 'locked' | 'completed' | 'cancelled';
// 'invited' — the app put you on a sheet because your squad was booked into a
// fixture; you have not answered yet. Distinct from 'approved', which means an
// organiser accepted a request you made. Only 'confirmed' counts toward
// filled_slots, so invited players never inflate the sheet.
export type PlayerStatus =
  | 'interested'
  | 'invited'
  | 'approved'
  | 'rejected'
  | 'confirmed';
export type JoinedVia = 'code' | 'browse' | 'alert' | 'challenge';
export type TeamRole = 'owner' | 'member';
// 'open'    — posted with no addressee; the matcher offers it to ranked teams.
// 'expired' — an open challenge nobody accepted before its start time.
export type ChallengeStatus =
  | 'pending'
  | 'open'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired';

export type CandidateStatus = 'offered' | 'accepted' | 'expired';

/**
 * Wides and no-balls are re-bowled and do not advance the over; byes and leg
 * byes do. That single distinction drives over completion, balls faced and
 * bowler economy, so it is modelled once here.
 */
export type ExtraType = 'wide' | 'no_ball' | 'bye' | 'leg_bye';

export type WicketType =
  | 'bowled'
  | 'caught'
  | 'lbw'
  | 'run_out'
  | 'stumped'
  | 'hit_wicket';
export type ChallengeDirection = 'incoming' | 'outgoing';
export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';
export type Platform = 'ios' | 'android';
export type AppRole = 'moderator' | 'superadmin';
export type NotificationKind =
  | 'join_requested'
  | 'join_approved'
  | 'join_confirmed'
  | 'challenge_received';
export type NotificationJobStatus = 'pending' | 'processing' | 'sent' | 'failed';

type Timestamped = { created_at: string };

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          area_name: string | null;
          sport_pref: Sport[];
          home_lat: number | null;
          home_lng: number | null;
          avatar_url: string | null;
          reliability_score: number | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          phone?: string | null;
          area_name?: string | null;
          sport_pref?: Sport[];
          home_lat?: number | null;
          home_lng?: number | null;
          avatar_url?: string | null;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      venues: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
          sport_types: Sport[];
          phone: string | null;
          confirm_note: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          name: string;
          lat: number;
          lng: number;
          confirm_note: string;
          address?: string | null;
          sport_types?: Sport[];
          phone?: string | null;
          created_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['venues']['Insert']>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          creator_id: string;
          match_name: string;
          sport: Sport;
          venue_id: string | null;
          venue_text: string | null;
          scheduled_at: string;
          total_slots: number;
          filled_slots: number;
          missing_count: number;
          status: MatchStatus;
          share_code: string;
          lat: number;
          lng: number;
          notes: string | null;
          created_at: string;
          /**
           * Head-to-head context. Set only when the match was created by
           * accepting a team challenge; null for a casual match. These were
           * added by challenge_fixes but never reached this file — the roster
           * code reads them through get_match_sides, which is why nothing broke.
           */
          team_a_id: string | null;
          team_b_id: string | null;
          challenge_id: string | null;
          /** Overs per innings. Null for badminton, and until the toss sets it. */
          overs: number | null;
          /** Set on the first call to start_innings and fixed for the match. */
          scorer_id: string | null;
          motm_user_id: string | null;
          /** e.g. "ASR WARRIORS won by 12 runs". Written by finish_match. */
          result_text: string | null;
        };
        Insert: {
          creator_id: string;
          match_name: string;
          sport: Sport;
          scheduled_at: string;
          total_slots: number;
          lat: number;
          lng: number;
          share_code: string;
          venue_id?: string | null;
          venue_text?: string | null;
          missing_count?: number;
          notes?: string | null;
        };
        Update: Partial<Database['public']['Tables']['matches']['Insert']> & {
          status?: MatchStatus;
          filled_slots?: number;
          missing_count?: number;
        };
        Relationships: [];
      };
      match_players: {
        Row: Timestamped & {
          id: string;
          match_id: string;
          user_id: string;
          status: PlayerStatus;
          joined_via: JoinedVia;
          /** Which squad this player is on. Null for a non-fixture match. */
          team_id: string | null;
        };
        Insert: {
          match_id: string;
          user_id: string;
          joined_via?: JoinedVia;
          status?: PlayerStatus;
          team_id?: string | null;
        };
        Update: { status?: PlayerStatus };
        Relationships: [];
      };
      attendance: {
        Row: Timestamped & {
          id: string;
          match_id: string;
          user_id: string;
          attended: boolean;
          marked_by: string;
        };
        Insert: { match_id: string; user_id: string; attended: boolean; marked_by: string };
        Update: { attended?: boolean };
        Relationships: [];
      };
      availability: {
        Row: Timestamped & {
          id: string;
          user_id: string;
          sport: Sport;
          available_date: string;
          lat: number;
          lng: number;
          note: string | null;
          expires_at: string;
        };
        Insert: {
          user_id: string;
          sport: Sport;
          available_date: string;
          lat: number;
          lng: number;
          expires_at: string;
          note?: string | null;
        };
        Update: Partial<Database['public']['Tables']['availability']['Insert']>;
        Relationships: [];
      };
      devices: {
        Row: Timestamped & {
          id: string;
          user_id: string;
          fcm_token: string;
          platform: Platform;
          last_seen: string;
        };
        /** fcm_token holds an Expo push token; the client writes it via the
         *  register_device RPC rather than inserting directly. */
        Insert: { user_id: string; fcm_token: string; platform: Platform };
        Update: { last_seen?: string };
        Relationships: [];
      };
      /** Outbound push queue. RLS denies all client access — present here only so
       *  the Edge Function's service-role client is type-safe. */
      notification_jobs: {
        Row: Timestamped & {
          id: string;
          user_id: string;
          kind: NotificationKind;
          title: string;
          body: string;
          data: Record<string, unknown>;
          status: NotificationJobStatus;
          attempts: number;
          last_error: string | null;
          claimed_at: string | null;
          processed_at: string | null;
        };
        Insert: never;
        Update: {
          status?: NotificationJobStatus;
          last_error?: string | null;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: Timestamped & {
          id: string;
          reporter_id: string;
          reported_user_id: string;
          match_id: string | null;
          reason: string;
          details: string | null;
          status: ReportStatus;
        };
        Insert: {
          reporter_id: string;
          reported_user_id: string;
          reason: string;
          match_id?: string | null;
          details?: string | null;
        };
        Update: { status?: ReportStatus };
        Relationships: [];
      };
      blocks: {
        Row: Timestamped & { id: string; blocker_id: string; blocked_id: string };
        Insert: { blocker_id: string; blocked_id: string };
        Update: never;
        Relationships: [];
      };
      roles: {
        Row: {
          id: string;
          name: AppRole;
          description: string | null;
          created_at: string;
        };
        Insert: { name: AppRole; description?: string | null };
        Update: { name?: AppRole; description?: string | null };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          granted_by: string | null;
          granted_at: string;
        };
        Insert: { user_id: string; role_id: string; granted_by?: string | null };
        Update: { role_id?: string };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          name: string;
          sport: Sport;
          owner_id: string;
          invite_code: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sport: Sport;
          owner_id: string;
          invite_code: string;
          created_at?: string;
        };
        Update: { name?: string; sport?: Sport };
        Relationships: [];
      };
      challenge_candidates: {
        Row: {
          id: string;
          challenge_id: string;
          team_id: string;
          rank: number;
          distance_m: number;
          status: CandidateStatus;
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      team_challenges: {
        Row: {
          id: string;
          from_team_id: string;
          /** Null while an open challenge is unclaimed; set when accepted. */
          to_team_id: string | null;
          created_by: string;
          match_name: string;
          venue_id: string;
          scheduled_at: string;
          total_slots: number;
          message: string | null;
          status: ChallengeStatus;
          match_id: string | null;
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          user_id: string;
          role: TeamRole;
          joined_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          user_id: string;
          role?: TeamRole;
          joined_at?: string;
        };
        Update: { role?: TeamRole };
        Relationships: [];
      };
    };
    Views: {
      user_role_names: {
        Row: { user_id: string; role: AppRole };
        Relationships: [];
      };
      /**
       * Non-PII projection of `profiles`, active users only. This is the ONLY
       * way to read another user's profile — the base table is self-read after
       * the security_hardening migration. No phone, no home coordinates.
       */
      public_profiles: {
        Row: {
          id: string;
          full_name: string;
          area_name: string | null;
          avatar_url: string | null;
          sport_pref: Sport[];
          created_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      nearby_matches: {
        Args: {
          in_lat: number;
          in_lng: number;
          in_radius_m?: number;
          in_sport?: Sport | null;
        };
        Returns: Database['public']['Tables']['matches']['Row'][];
      };
      nearby_available: {
        Args: {
          in_lat: number;
          in_lng: number;
          in_radius_m?: number;
          in_sport?: Sport | null;
        };
        Returns: Database['public']['Tables']['availability']['Row'][];
      };
      join_match: {
        Args: { in_match_id: string; in_joined_via?: JoinedVia };
        Returns: Database['public']['Tables']['match_players']['Row'];
      };
      join_team: {
        Args: { in_invite_code: string };
        Returns: Database['public']['Tables']['teams']['Row'];
      };
      /** Upserts this device's Expo push token against the signed-in user. */
      register_device: {
        Args: { in_token: string; in_platform: Platform };
        Returns: undefined;
      };
      /** Must be called before signOut(); it is scoped by auth.uid(). */
      unregister_device: {
        Args: { in_token: string };
        Returns: undefined;
      };
      /** Service role only — drained by the notify-wave Edge Function. */
      claim_notification_jobs: {
        Args: { in_limit?: number };
        Returns: {
          id: string;
          user_id: string;
          title: string;
          body: string;
          data: Record<string, unknown>;
          tokens: string[];
        }[];
      };
      create_challenge: {
        Args: {
          in_from_team_id: string;
          in_opponent_code: string;
          in_match_name: string;
          in_venue_id: string;
          in_scheduled_at: string;
          in_total_slots: number;
          in_message?: string | null;
        };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      respond_to_challenge: {
        Args: { in_challenge_id: string; in_accept: boolean };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      cancel_challenge: {
        Args: { in_challenge_id: string };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      /** Denormalised for the challenges screen — teams_select is members-only,
       *  so the opponent's team row is otherwise unreadable. */
      post_open_challenge: {
        Args: {
          in_from_team_id: string;
          in_match_name: string;
          in_venue_id: string;
          in_scheduled_at: string;
          in_total_slots: number;
          in_message?: string | null;
          in_radius_m?: number;
        };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      accept_open_challenge: {
        Args: { in_challenge_id: string; in_team_id: string };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      respond_to_match_invite: {
        Args: { in_match_id: string; in_accept: boolean };
        Returns: Database['public']['Tables']['match_players']['Row'];
      };
      list_match_players: {
        Args: { in_match_id: string };
        Returns: {
          id: string;
          user_id: string;
          full_name: string | null;
          area_name: string | null;
          avatar_url: string | null;
          status: PlayerStatus;
          joined_via: JoinedVia;
          team_id: string | null;
          team_name: string | null;
          side: 'a' | 'b' | null;
          created_at: string;
        }[];
      };
      start_innings: {
        Args: { in_match_id: string };
        Returns: {
          id: string;
          match_id: string;
          number: number;
          batting_team_id: string;
          bowling_team_id: string;
          target: number | null;
          status: 'in_progress' | 'completed';
          runs: number;
          wickets: number;
          legal_balls: number;
          created_at: string;
          ended_at: string | null;
        };
      };
      record_delivery: {
        Args: {
          in_innings_id: string;
          in_striker_id: string;
          in_non_striker_id: string | null;
          in_bowler_id: string;
          in_runs_off_bat?: number;
          in_extra_type?: ExtraType | null;
          in_extra_runs?: number;
          in_wicket_type?: WicketType | null;
          in_out_player_id?: string | null;
        };
        Returns: Record<string, unknown>;
      };
      undo_last_delivery: { Args: { in_innings_id: string }; Returns: number };
      end_innings: {
        Args: { in_innings_id: string };
        Returns: Database['public']['Functions']['start_innings']['Returns'];
      };
      finish_match: {
        Args: { in_match_id: string; in_motm_user_id?: string | null };
        Returns: Database['public']['Tables']['matches']['Row'];
      };
      get_live_state: {
        Args: { in_match_id: string };
        Returns: {
          innings_id: string;
          innings_number: number;
          batting_team_id: string;
          batting_team: string;
          bowling_team_id: string;
          bowling_team: string;
          runs: number;
          wickets: number;
          legal_balls: number;
          overs_limit: number | null;
          target: number | null;
          status: 'in_progress' | 'completed';
          i_am_scorer: boolean;
          last_ball_seq: number | null;
        }[];
      };
      get_this_over: {
        Args: { in_innings_id: string };
        Returns: {
          seq: number;
          over_number: number;
          ball_in_over: number;
          runs_off_bat: number;
          extra_type: ExtraType | null;
          extra_runs: number;
          wicket_type: WicketType | null;
          label: string;
        }[];
      };
      get_batting_card: {
        Args: { in_innings_id: string };
        Returns: {
          user_id: string;
          full_name: string | null;
          runs: number;
          balls: number;
          fours: number;
          sixes: number;
          strike_rate: number | null;
          is_out: boolean;
          wicket_type: WicketType | null;
        }[];
      };
      get_bowling_card: {
        Args: { in_innings_id: string };
        Returns: {
          user_id: string;
          full_name: string | null;
          legal_balls: number;
          overs_text: string;
          runs: number;
          wickets: number;
          economy: number | null;
        }[];
      };
      perform_toss: {
        Args: { in_match_id: string; in_overs?: number | null };
        Returns: {
          match_id: string;
          called_by: string;
          winner_team_id: string;
          outcome: 'heads' | 'tails';
          decision: 'bat' | 'bowl' | null;
          created_at: string;
          decided_at: string | null;
        };
      };
      set_toss_decision: {
        Args: { in_match_id: string; in_decision: 'bat' | 'bowl' };
        Returns: Database['public']['Functions']['perform_toss']['Returns'];
      };
      get_toss: {
        Args: { in_match_id: string };
        Returns: {
          match_id: string;
          winner_team_id: string;
          winner_team_name: string;
          outcome: 'heads' | 'tails';
          /** Null between the flip and the winner choosing. */
          decision: 'bat' | 'bowl' | null;
          overs: number | null;
          batting_team_id: string | null;
          bowling_team_id: string | null;
          i_am_captain: boolean;
          i_am_winner: boolean;
          created_at: string;
          decided_at: string | null;
        }[];
      };
      get_match_sides: {
        Args: { in_match_id: string };
        Returns: {
          team_a_id: string | null;
          team_a_name: string | null;
          team_b_id: string | null;
          team_b_name: string | null;
        }[];
      };
      list_my_challenges: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          status: ChallengeStatus;
          direction: ChallengeDirection;
          from_team_id: string;
          from_team_name: string;
          /** Both null for an open challenge that nobody has accepted yet. */
          to_team_id: string | null;
          to_team_name: string | null;
          match_name: string;
          venue_name: string;
          scheduled_at: string;
          total_slots: number;
          message: string | null;
          match_id: string | null;
          is_expired: boolean;
          i_can_respond: boolean;
          i_can_cancel: boolean;
          created_at: string;
        }[];
      };
      has_role: { Args: { in_role: AppRole; uid?: string }; Returns: boolean };
      is_admin: { Args: { uid?: string }; Returns: boolean };
      is_superadmin: { Args: { uid?: string }; Returns: boolean };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
