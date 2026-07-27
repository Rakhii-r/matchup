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
export type PlayerStatus = 'interested' | 'approved' | 'rejected' | 'confirmed';
export type JoinedVia = 'code' | 'browse' | 'alert';
export type ReportStatus = 'open' | 'reviewed' | 'actioned' | 'dismissed';
export type Platform = 'ios' | 'android';
export type AppRole = 'moderator' | 'superadmin';

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
        };
        Insert: {
          creator_id: string;
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
        };
        Insert: {
          match_id: string;
          user_id: string;
          joined_via?: JoinedVia;
          status?: PlayerStatus;
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
        Insert: { user_id: string; fcm_token: string; platform: Platform };
        Update: { last_seen?: string };
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
    };
    Views: {
      user_role_names: {
        Row: { user_id: string; role: AppRole };
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
      has_role: { Args: { in_role: AppRole; uid?: string }; Returns: boolean };
      is_admin: { Args: { uid?: string }; Returns: boolean };
      is_superadmin: { Args: { uid?: string }; Returns: boolean };
    };
    Enums: { app_role: AppRole };
    CompositeTypes: { [_ in never]: never };
  };
}
