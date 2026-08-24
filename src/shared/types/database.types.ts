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
// Which creation engine made the fixture, and therefore which rules apply.
// 'team_vs_team' — posted by a team owner, opponent found by the radar search.
// 'open'         — Post a Match: no teams at all, individuals take seats.
// NOT NULL with a 'team_vs_team' default, so a row that predates the column
// reads as the flow that actually created it.
export type MatchType = 'team_vs_team' | 'open';
// Why this person is on the sheet. Display metadata only: every authority check
// reads matches.creator_id, never this.
export type MatchPlayerRole = 'creator' | 'player';
export type TeamRole = 'owner' | 'vice_captain' | 'member';
// 'open'    — posted with no addressee; the matcher offers it to ranked teams.
// 'expired' — an open challenge nobody accepted before its start time.
export type ChallengeStatus =
  | 'pending'
  | 'open'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired';

export type CandidateStatus = 'offered' | 'interested' | 'accepted' | 'declined' | 'expired';

/**
 * How seriously the fixture is being played. Stored as `text` with a CHECK and
 * a `'friendly'` default on both `matches` and `team_challenges`, so a row that
 * predates the column still reads as a valid value rather than null.
 */
export type GameType = 'friendly' | 'competitive';

/**
 * Wides and no-balls are re-bowled and do not advance the over; byes and leg
 * byes do. That single distinction drives over completion, balls faced and
 * bowler economy, so it is modelled once here.
 */
export type PlayingRole = 'batter' | 'bowler' | 'all_rounder' | 'keeper';

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
      sports: {
        Row: { id: string; sport: Sport; name: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; sport: Sport; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { name?: string; is_active?: boolean; updated_at?: string };
        Relationships: [];
      };
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
          // Added 15 Aug 2026. All nullable: an unpopulated venue renders its
          // empty state rather than a fabricated rating or price.
          image_url: string | null;
          rating: number | null;
          rating_count: number;
          price_per_hour: number | null;
          facilities: string[];
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
          image_url?: string | null;
          rating?: number | null;
          rating_count?: number;
          price_per_hour?: number | null;
          facilities?: string[];
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
          area_name: string | null;
          scheduled_at: string;
          total_slots: number;
          filled_slots: number;
          missing_count: number;
          status: MatchStatus;
          share_code: string;
          lat: number;
          lng: number;
          match_lat: number | null;
          match_lng: number | null;
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
          /** NOT NULL with a 'friendly' default — never null on a read. */
          game_type: GameType;
          /** When the booking ends. timestamptz, null when the organiser left it open. */
          end_time: string | null;
          /**
           * Metres. Set by an open challenge, and by Post a Match — where
           * nearby_matches actually enforces it, so the poster's Search
           * Distance chips decide who can discover the fixture.
           */
          search_radius_m: number | null;
          match_type: MatchType;
          rematch_of: string | null;
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
          area_name?: string | null;
          match_lat?: number | null;
          match_lng?: number | null;
          missing_count?: number;
          notes?: string | null;
          game_type?: GameType;
          end_time?: string | null;
          search_radius_m?: number | null;
          match_type?: MatchType;
          rematch_of?: string | null;
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
          /**
           * 'creator' on the single row create_open_match writes for the host.
           * A team fixture writes no row for its creator at all, so every row
           * there is 'player'.
           */
          role: MatchPlayerRole;
        };
        Insert: {
          match_id: string;
          user_id: string;
          joined_via?: JoinedVia;
          status?: PlayerStatus;
          team_id?: string | null;
          role?: MatchPlayerRole;
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
          description: string | null;
          logo_url: string | null;
          home_ground: string | null;
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
        Update: { name?: string; sport?: Sport; description?: string | null; logo_url?: string | null; home_ground?: string | null };
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
          /** NOT NULL with a 'friendly' default — never null on a read. */
          game_type: GameType;
          /** timestamptz, null when the poster left the finish time open. */
          end_time: string | null;
          /** How far the matcher was told to look, in metres. */
          search_radius_m: number | null;
        };
        // Writes go through post_open_challenge / create_challenge only, so
        // there is no client-side Insert to widen — the three columns above are
        // set by the RPC from in_game_type / in_end_time / in_radius_m.
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
      /**
       * Post a Match. Creates the fixture AND seats the caller as its host in
       * one transaction, so the roster is never momentarily empty. Takes no
       * team of any kind — that is the whole difference from
       * post_open_challenge. Signature verified against
       * pg_get_function_arguments on 18 Aug 2026.
       */
      create_open_match: {
        Args: {
          in_sport: Sport;
          in_match_name: string;
          in_area_name: string;
          in_scheduled_at: string;
          in_total_slots: number;
          /** timestamptz or null when the organiser left the finish open. */
          in_end_time?: string | null;
          in_game_type?: GameType;
          in_radius_m?: number;
          in_lat?: number | null;
          in_lng?: number | null;
          in_venue_id?: string | null;
        };
        Returns: Database['public']['Tables']['matches']['Row'];
      };
      /**
       * Take a seat in an open match. Lands on 'confirmed' directly — there is
       * no approval queue, which is what join_match does instead for a team
       * fixture. Idempotent: a second call returns the existing row.
       */
      join_open_match: {
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
          in_area_name: string;
          in_scheduled_at: string;
          in_total_slots: number;
          in_message?: string | null;
          in_radius_m?: number;
          /** Defaults to 'friendly' server-side. */
          in_game_type?: GameType;
          /** timestamptz or null. Verified against pg_get_function_arguments. */
          in_end_time?: string | null;
          in_lat?: number | null;
          in_lng?: number | null;
          in_venue_id?: string | null;
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
          role: MatchPlayerRole;
          team_id: string | null;
          team_name: string | null;
          side: 'a' | 'b' | null;
          created_at: string;
        }[];
      };
      get_player_stats: {
        Args: { in_user_id?: string | null };
        Returns: {
          user_id: string;
          full_name: string | null;
          area_name: string | null;
          avatar_url: string | null;
          playing_role: PlayingRole | null;
          matches_played: number;
          wins: number;
          win_rate: number;
          runs: number;
          wickets: number;
          motm: number;
        }[];
      };
      // Per-completed-match batting card for the Profile statistics screen.
      // Verified against pg_get_function_result on 17 Aug 2026:
      //   TABLE(match_id uuid, match_name text, played_at timestamptz,
      //         opponent_name text, outcome text, overs integer, runs integer,
      //         balls integer, fours integer, sixes integer, is_out boolean,
      //         strike_rate numeric, is_motm boolean)
      // Nullable for real reasons, not defensiveness: `opponent_name` is a LEFT
      // JOIN onto teams (an open match has no named opponent), `overs` is
      // nullable on `matches` (fixtures that predate in-app scoring), and
      // `strike_rate` divides by `nullif(balls, 0)`, so a match where the
      // player never faced a ball returns null rather than 0.
      get_player_batting_history: {
        Args: { in_user_id?: string | null; in_limit?: number };
        Returns: {
          match_id: string;
          match_name: string;
          played_at: string;
          opponent_name: string | null;
          outcome: 'won' | 'lost' | 'tied';
          overs: number | null;
          runs: number;
          balls: number;
          fours: number;
          sixes: number;
          is_out: boolean;
          strike_rate: number | null;
          is_motm: boolean;
        }[];
      };
      // These three mirror the deployed function signatures exactly. Verified
      // against pg_get_function_result on 15 Aug 2026 — the previous shapes
      // named columns (captain_id, team_a_name, my_runs) the functions never
      // returned, which read as undefined at runtime with no type error.
      get_team_overview: {
        Args: { in_team_id: string };
        Returns: { id: string; name: string; sport: Sport; invite_code: string; created_at: string; description: string | null; logo_url: string | null; home_ground: string | null; owner_id: string; captain_name: string | null; captain_avatar: string | null; player_count: number; my_role: TeamRole | null; i_am_owner: boolean }[];
      };
      // Every figure the Teams tab shows, for every team the caller belongs to,
      // in one round trip. Replaces a get_team_overview + get_team_stats pair
      // per rendered card.
      get_my_teams_overview: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; sport: Sport; invite_code: string; logo_url: string | null; home_ground: string | null; player_count: number; my_role: TeamRole; i_am_owner: boolean; matches_played: number; wins: number; losses: number; ties: number; win_rate: number }[];
      };
      get_team_stats: {
        Args: { in_team_id: string };
        Returns: { team_id: string; matches_played: number; wins: number; losses: number; ties: number; win_rate: number; highest_score: number | null; lowest_score: number | null }[];
      };
      get_team_fixtures: {
        Args: { in_team_id: string };
        Returns: { match_id: string; match_name: string; scheduled_at: string; venue_text: string | null; status: MatchStatus; is_upcoming: boolean; opponent_id: string | null; opponent_name: string | null; is_home: boolean; our_runs: number | null; our_wickets: number | null; their_runs: number | null; their_wickets: number | null; outcome: 'won' | 'lost' | 'tied' | null; result_text: string | null }[];
      };
      set_member_role: {
        Args: { in_team_id: string; in_user_id: string; in_role: 'member' | 'vice_captain' };
        Returns: Database['public']['Tables']['team_members']['Row'];
      };
      decline_open_challenge: { Args: { in_challenge_id: string; in_team_id: string }; Returns: Database['public']['Tables']['challenge_candidates']['Row'] };
      /**
       * The offer ledger for one open challenge, with each candidate team's
       * public facts resolved server-side.
       *
       * Selecting challenge_candidates and embedding `team:teams(name)` cannot
       * do this: `teams` is members-only under RLS, and the poster is by
       * definition not a member of the teams being offered to, so every
       * embedded name comes back NULL. This function is SECURITY DEFINER and
       * gated internally on `is_challenge_poster(in_challenge_id)`, so only the
       * poster gets rows and nothing else about `teams` is widened.
       *
       * Shape verified against pg_get_function_result. `logo_url` is null until
       * the team uploads one; `responded_at` is null while status is 'offered'.
       */
      get_challenge_candidates: {
        Args: { in_challenge_id: string };
        Returns: {
          candidate_id: string;
          team_id: string;
          team_name: string;
          logo_url: string | null;
          sport: string;
          player_count: number;
          matches_played: number;
          wins: number;
          losses: number;
          ties: number;
          /** Whole percent, already rounded server-side. */
          win_rate: number;
          rank: number;
          distance_m: number;
          status: CandidateStatus;
          responded_at: string | null;
          /**
           * True when the signed-in user OWNS this candidate team. A user with
           * two squads can legitimately have one offered the other's fixture,
           * and `accept_open_challenge` checks the ACCEPTING team's owner — so
           * this, not "am I the poster", is what decides whether Accept and
           * Reject can be shown on a candidate row.
           */
          i_own_team: boolean;
        }[];
      };
      get_my_next_match: {
        Args: Record<string, never>;
        Returns: {
          match_id: string;
          match_name: string;
          scheduled_at: string;
          venue_text: string | null;
          status: MatchStatus;
          team_a_id: string | null;
          team_a_name: string | null;
          team_b_id: string | null;
          team_b_name: string | null;
          my_status: PlayerStatus;
          confirmed_count: number;
          total_slots: number;
        }[];
      };
      get_my_recent_matches: {
        Args: { in_limit?: number };
        Returns: {
          match_id: string;
          match_name: string;
          played_at: string;
          my_team_id: string | null;
          my_team_name: string | null;
          opponent_name: string | null;
          my_runs: number | null;
          their_runs: number | null;
          outcome: 'won' | 'lost' | 'tied';
          result_text: string | null;
        }[];
      };
      list_my_notifications: {
        Args: { in_limit?: number };
        Returns: {
          id: string;
          kind: string;
          title: string;
          body: string;
          route: string | null;
          created_at: string;
        }[];
      };
      get_my_pending_actions: {
        Args: Record<string, never>;
        Returns: {
          kind: string;
          title: string;
          subtitle: string | null;
          route: string | null;
          urgency: 'high' | 'medium' | 'low';
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
      /**
       * Re-roll. perform_toss is idempotent by design and cannot re-roll, so
       * this is the only path that changes a toss. Captain-only, and refused
       * once `decision` is set.
       */
      redo_toss: {
        Args: { in_match_id: string };
        // match_toss has no Tables entry — it is reached only through the toss
        // RPCs — so the row shape is stated here.
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
      create_rematch: {
        Args: { in_match_id: string };
        Returns: Database['public']['Tables']['matches']['Row'];
      };
      cleanup_my_open_fixtures: {
        Args: Record<string, never>;
        Returns: number;
      };
      apply_to_open_challenge: {
        Args: { in_challenge_id: string; in_team_id: string };
        Returns: Database['public']['Tables']['challenge_candidates']['Row'];
      };
      list_open_challenges_nearby: {
        Args: {
          in_lat?: number | null;
          in_lng?: number | null;
          in_radius_m?: number;
          in_sport?: string | null;
        };
        Returns: {
          challenge_id: string;
          match_name: string;
          from_team_id: string;
          from_team_name: string;
          from_team_logo: string | null;
          sport: string;
          venue_id: string | null;
          venue_name: string;
          area_name: string;
          scheduled_at: string;
          total_slots: number;
          message: string | null;
          distance_m: number;
          created_at: string;
          applied_status: string | null;
        }[];
      };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
