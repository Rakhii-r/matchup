/**
 * Supabase schema types for the Phase 1 MatchUp database.
 *
 * This file is hand-written to match supabase/migrations/0001_phase1_schema.sql so the
 * app is type-safe today. Once the Supabase CLI is set up, regenerate it with:
 *   npm run db:types
 * (which runs `supabase gen types typescript --local`).
 */

export type Sport = 'box_cricket' | 'badminton';
/**
 * 'expired' — the game's time passed and expire_stale_matches() closed it
 * (20260901_expire_stale_matches). Distinct from 'cancelled', which means a
 * person called it off; nothing was called off here, the slot simply ran out.
 */
export type MatchStatus = 'open' | 'locked' | 'completed' | 'cancelled' | 'expired';
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
      captain_chat_messages: {
        Row: {
          id: string;
          challenge_id: string | null;
          match_id: string | null;
          sender_id: string;
          recipient_id: string;
          content: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          challenge_id?: string | null;
          match_id?: string | null;
          sender_id: string;
          recipient_id: string;
          content: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          challenge_id?: string | null;
          match_id?: string | null;
          sender_id?: string;
          recipient_id?: string;
          content?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
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
          /**
           * Push mute switches, keyed by GROUP not by kind (see notif_group in
           * 20260831174915). An absent key means enabled -- only an explicit
           * false mutes -- so an empty object is every notification on.
           */
          notif_prefs: Record<string, boolean>;
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
          notif_prefs?: Record<string, boolean>;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      team_join_requests: {
        Row: {
          id: string;
          team_id: string;
          user_id: string;
          status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
          message: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
        };
        Insert: { team_id: string; user_id: string; message?: string | null };
        Update: Partial<Database['public']['Tables']['team_join_requests']['Insert']>;
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
          // Added 30 Aug 2026. The picker (nearby_venues) returns 'approved'
          // rows only; captain suggestions land 'pending'; the out-of-city seed
          // rows and the lat/lng 0,0 row are 'hidden' rather than deleted,
          // because matches_venue_id_fkey is ON DELETE SET NULL.
          status: 'approved' | 'pending' | 'hidden';
          suggested_by: string | null;
          operating_hours_start: string;
          operating_hours_end: string;
          slot_duration_minutes: number;
          courts_count: number;
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
          status?: 'approved' | 'pending' | 'hidden';
          suggested_by?: string | null;
          operating_hours_start?: string;
          operating_hours_end?: string;
          slot_duration_minutes?: number;
          courts_count?: number;
        };
        Update: Partial<Database['public']['Tables']['venues']['Insert']>;
        Relationships: [];
      };
      venue_bookings: {
        Row: {
          id: string;
          venue_id: string;
          court_number: number;
          user_id: string;
          start_time: string;
          end_time: string;
          status: 'confirmed' | 'cancelled';
          match_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
        };
        Insert: {
          id?: string;
          venue_id: string;
          court_number: number;
          user_id?: string;
          start_time: string;
          end_time: string;
          status?: 'confirmed' | 'cancelled';
          match_id?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['venue_bookings']['Insert']>;
        Relationships: [
          {
            foreignKeyName: "venue_bookings_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_bookings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "venue_bookings_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
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
      /**
       * One innings of a scored match. Totals are maintained by the
       * `sync_innings_totals` trigger from `deliveries` and are never written
       * by hand. Read-only from the client: every write goes through an RPC
       * (`start_innings`, `record_delivery`, `end_innings`).
       */
      innings: {
        Row: Timestamped & {
          id: string;
          match_id: string;
          number: 1 | 2;
          batting_team_id: string;
          bowling_team_id: string;
          /** Innings 2 only. Runs needed to WIN (first-innings total + 1). */
          target: number | null;
          status: 'in_progress' | 'completed';
          runs: number;
          wickets: number;
          legal_balls: number;
          ended_at: string | null;
        };
        Insert: never;
        Update: never;
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
          /**
           * The team's FORMAT in players per side: 4 means "we are a 4 v 4
           * side". Re-purposed from "recruiting target" in
           * 20260903090000_squad_only_matchmaking.sql.
           *
           * NULL is not a wildcard — it means the team has not declared a
           * format and is out of matchmaking in both directions: the radar
           * cannot rank it and `list_open_challenges_nearby` shows it nothing.
           */
          target_size: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sport: Sport;
          owner_id: string;
          invite_code: string;
          target_size?: number | null;
          description?: string | null;
          logo_url?: string | null;
          home_ground?: string | null;
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
      /**
       * Venues near a point, for the area-scoped venue picker. Hand-written to
       * match the RETURNS TABLE in 20260827120000_nearby_venues.sql — this file
       * is not generated, so the two are kept in step by hand.
       *
       * Not `venues.Row` + distance: the RPC returns a flat RETURNS TABLE whose
       * column set is the venue columns minus `location` and `created_by` /
       * `created_at`. Writing it out is what stops it silently drifting.
       */
      nearby_venues: {
        Args: {
          in_lat: number;
          in_lng: number;
          in_radius_m?: number;
          in_sport?: Sport | null;
        };
        Returns: {
          id: string;
          name: string;
          address: string | null;
          lat: number;
          lng: number;
          sport_types: Sport[];
          phone: string | null;
          confirm_note: string;
          image_url: string | null;
          rating: number | null;
          rating_count: number;
          price_per_hour: number | null;
          facilities: string[];
          distance_m: number;
          operating_hours_start: string;
          operating_hours_end: string;
          slot_duration_minutes: number;
          courts_count: number;
        }[];
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
        Args: {
          in_challenge_id: string;
          in_team_id: string;
          /**
           * The ACCEPTING captain's squad, exactly the format size and
           * including themselves. Required: the two-argument overload was
           * dropped in 20260907160000, because confirming a fixture with no
           * named squad is the behaviour that migration replaced.
           *
           * Note this is the caller's OWN team's lineup, which is not always
           * `in_team_id` — a host accepting an applicant names `from_team_id`.
           * The RPC resolves that itself.
           */
          in_lineup: string[];
        };
        Returns: Database['public']['Tables']['team_challenges']['Row'];
      };
      /**
       * Replace one team's squad for a match. A "lineup" is the set of
       * `match_players` rows for that team on that match — there is no separate
       * lineup table. Enforces exact format size, roster membership, no
       * duplicates and the captain's own inclusion, and notifies only the
       * players it seats.
       */
      set_match_lineup: {
        Args: { in_match_id: string; in_team_id: string; in_user_ids: string[] };
        Returns: Database['public']['Tables']['match_players']['Row'][];
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
        Returns: { id: string; name: string; sport: Sport; invite_code: string; created_at: string; description: string | null; logo_url: string | null; home_ground: string | null; owner_id: string; captain_name: string | null; captain_avatar: string | null; player_count: number; my_role: TeamRole | null; i_am_owner: boolean; target_size: number | null }[];
      };
      // Every figure the Teams tab shows, for every team the caller belongs to,
      // in one round trip. Replaces a get_team_overview + get_team_stats pair
      // per rendered card.
      /**
       * The team's declared FORMAT, in players per side.
       *
       * The RPC keeps its old name because the column does
       * (`teams.target_size`), but its meaning changed in
       * 20260903090000_squad_only_matchmaking.sql: it was "recruit up to N
       * players" and is now "we are an N v N side". It is the value strict
       * format-to-format matchmaking compares on both sides of every fixture,
       * and null means the team is not in matchmaking at all.
       *
       * `list_teams_needing_players`, `request_to_join_team`,
       * `list_team_join_requests` and `respond_to_join_request` were dropped in
       * the same migration with the solo-player Find Players flow.
       */
      set_team_target_size: {
        Args: { in_team_id: string; in_size: number | null };
        Returns: Database['public']['Tables']['teams']['Row'];
      };
      get_my_teams_overview: {
        Args: Record<string, never>;
        Returns: { id: string; name: string; sport: Sport; invite_code: string; logo_url: string | null; home_ground: string | null; player_count: number; my_role: TeamRole; i_am_owner: boolean; matches_played: number; wins: number; losses: number; ties: number; win_rate: number; /** The team's declared format in players per side. Null = not in matchmaking. Added 20260903090000. */ target_size: number | null }[];
      };
      get_team_stats: {
        Args: { in_team_id: string };
        Returns: { team_id: string; matches_played: number; wins: number; losses: number; ties: number; win_rate: number; highest_score: number | null; lowest_score: number | null }[];
      };
      get_team_fixtures: {
        Args: { in_team_id: string };
        Returns: { match_id: string; match_name: string; scheduled_at: string; venue_text: string | null; status: MatchStatus; is_upcoming: boolean; opponent_id: string | null; opponent_name: string | null; is_home: boolean; our_runs: number | null; our_wickets: number | null; their_runs: number | null; their_wickets: number | null; outcome: 'won' | 'lost' | 'tied' | null; result_text: string | null }[];
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
          /*
            `i_own_team` used to be declared here and was REMOVED on 7 Sep 2026.
            `20260822122000_interactive_team_matchmaking` redefined
            get_challenge_candidates without it, so the column has not existed
            since August — the type promised `boolean` and delivered
            `undefined`, which TypeScript cannot catch because generated types
            are asserted rather than checked.

            It was not restored, because the clause it guarded is unreachable
            anyway: `rank_challenge_candidates` excludes teams the poster owns
            (`t.owner_id <> c.created_by`), so an 'offered' candidate row can
            never BE one of your own teams. Adding the column back would have
            produced a flag that is always false.
          */
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
          /** Null for a team-only ball — see the team_only_scoring migration. */
          in_striker_id: string | null;
          in_non_striker_id: string | null;
          in_bowler_id: string | null;
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
          venue_name: string | null;
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
      /**
       * Attach or clear a match's venue after creation. Organiser-only.
       * `in_venue_id: null` clears the tag. See
       * 20260827110000_set_match_venue.sql.
       */
      /**
       * Captain-suggested ground. Hand-written to match
       * 20260830140000_suggest_venue.sql. Coordinates come from the device, not
       * a geocoder, so lat/lng are required and 0,0 is rejected server-side —
       * that value is how the null-island row got into this table.
       */
      suggest_venue: {
        Args: {
          in_name: string;
          in_address: string | null;
          in_lat: number;
          in_lng: number;
          in_sport: Sport;
        };
        Returns: Database['public']['Tables']['venues']['Row'];
      };
      /** Approve or hide a ground. Admin-only, enforced server-side. */
      set_venue_status: {
        Args: { in_venue_id: string; in_status: 'approved' | 'pending' | 'hidden' };
        Returns: Database['public']['Tables']['venues']['Row'];
      };
      set_match_venue: {
        Args: { in_match_id: string; in_venue_id?: string | null };
        Returns: Database['public']['Tables']['matches']['Row'];
      };
      /**
       * Player of the Game, awarded after the fact from the result screen.
       * Organiser or scorer only; the game must be completed and the user must
       * be on its sheet. A null id clears the award.
       * 20260831174852_set_motm_and_game_tied.sql.
       */
      /**
       * Hard-delete a game. Organiser only, and refused once anyone else has
       * joined (MATCH_HAS_PLAYERS) or a ball has been bowled / it is finished
       * (MATCH_ALREADY_PLAYED) -- cancelling is the honest action then.
       * 20260901052359_all_out_and_delete_match.sql.
       */
      delete_match: {
        Args: { in_match_id: string };
        Returns: undefined;
      };
      set_motm: {
        Args: { in_match_id: string; in_user_id?: string | null };
        Returns: Database['public']['Tables']['matches']['Row'];
      };
      /**
       * Venue ratings. 20260831174949_venue_ratings.sql. `rate_venue` refuses
       * anyone who was not on the sheet for a completed game at that ground
       * (NOT_PLAYED_HERE) and upserts, so rating again replaces your score.
       * A trigger recomputes venues.rating / rating_count from the rows.
       */
      rate_venue: {
        Args: { in_venue_id: string; in_rating: number };
        Returns: Database['public']['Tables']['venues']['Row'];
      };
      /** Returns exactly one row: may the caller rate, and what did they give. */
      my_venue_rating: {
        Args: { in_venue_id: string };
        Returns: { can_rate: boolean; my_rating: number | null }[];
      };
      /**
       * Captain chat. All three hand-written to match
       * 20260830090000_captain_chat_rpcs_and_lockdown.sql. The client holds
       * only SELECT on captain_chat_messages, so these RPCs are the only
       * read/write path -- there is no direct-table fallback if a signature
       * here drifts from pg_proc.
       *
       * A thread is (match or challenge) PLUS the counterpart. The counterpart
       * is named by in_to_team_id (an applicant list knows the team) or
       * in_other_user_id (a push tap knows only the sender); both are ignored
       * for a match, where the two sides are already settled.
       */
      send_captain_message: {
        Args: {
          in_match_id: string | null;
          in_challenge_id: string | null;
          in_to_team_id: string | null;
          in_other_user_id: string | null;
          in_content: string;
        };
        Returns: Database['public']['Tables']['captain_chat_messages']['Row'];
      };
      get_captain_chat: {
        Args: {
          in_match_id: string | null;
          in_challenge_id: string | null;
          in_to_team_id: string | null;
          in_other_user_id: string | null;
        };
        Returns: {
          id: string;
          challenge_id: string | null;
          match_id: string | null;
          sender_id: string;
          recipient_id: string;
          content: string;
          is_read: boolean;
          created_at: string;
          sender_name: string | null;
          sender_avatar: string | null;
          counterpart_id: string;
          counterpart_name: string | null;
        }[];
      };
      mark_chat_read: {
        Args: {
          in_match_id: string | null;
          in_challenge_id: string | null;
          in_to_team_id: string | null;
          in_other_user_id: string | null;
        };
        Returns: number;
      };
      /**
       * Every game played inside one booked slot, oldest first. Hand-written
       * to match the RETURNS TABLE in 20260825120000_slot_multi_match.sql —
       * this file is not generated, so the two are kept in step by hand.
       */
      get_match_series: {
        Args: { in_match_id: string };
        Returns: {
          id: string;
          game_number: number;
          match_name: string;
          status: string;
          scheduled_at: string;
          end_time: string | null;
          team_a_id: string | null;
          team_b_id: string | null;
          winner_team_id: string | null;
          result_text: string | null;
          team_a_runs: number | null;
          team_a_wickets: number | null;
          team_b_runs: number | null;
          team_b_wickets: number | null;
          is_current: boolean;
        }[];
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
          /**
           * The caller's team format in players per side. NOT optional in
           * practice: the function returns zero rows for a null, because a team
           * that has not declared a format cannot legally accept any fixture.
           */
          in_team_size: number | null;
        };
        Returns: {
          challenge_id: string;
          match_name: string;
          from_team_id: string;
          from_team_name: string;
          from_team_logo: string | null;
          sport: string;
          venue_id: string | null;
          venue_name: string | null;
          area_name: string;
          scheduled_at: string;
          total_slots: number;
          message: string | null;
          distance_m: number;
          created_at: string;
          applied_status: string | null;
        }[];
      };
      get_venue_slots: {
        Args: {
          in_venue_id: string;
          in_date: string;
          in_timezone?: string;
        };
        Returns: {
          court_number: number;
          court_label: string;
          start_time: string;
          end_time: string;
          time_hhmm: string;
          end_time_hhmm: string;
          is_available: boolean;
          booking_id: string | null;
          is_my_booking: boolean;
        }[];
      };
      book_venue_slot: {
        Args: {
          in_venue_id: string;
          in_court_number: number;
          in_start_time: string;
          in_end_time: string;
          in_match_id?: string | null;
          in_notes?: string | null;
        };
        Returns: Database['public']['Tables']['venue_bookings']['Row'];
      };
      cancel_venue_booking: {
        Args: {
          in_booking_id: string;
        };
        Returns: Database['public']['Tables']['venue_bookings']['Row'];
      };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
