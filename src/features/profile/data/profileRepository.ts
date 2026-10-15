import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import type { Profile } from '@core/auth/authStore';
import type { Sport } from '@shared/types/database.types';

export interface CreateProfileInput {
  userId: string;
  fullName: string;
  areaName: string;
  sportPref: Sport[];
  homeLat?: number | null;
  homeLng?: number | null;
  avatarUrl?: string | null;
}

export interface UpdateProfileInput {
  userId: string;
  fullName: string;
  areaName: string;
  sportPref: Sport[];
  avatarUrl?: string | null;
  /**
   * Coordinates were previously settable only at signup. Anyone who declined
   * the location prompt then had null coords forever, which silently disables
   * every nearby feature with no way back — the Edit Profile screen had no
   * field that could repair it. Same three-valued rule as avatarUrl:
   * `undefined` leaves the stored value alone.
   */
  homeLat?: number | null;
  homeLng?: number | null;
}

/** Reads/writes the current user's profile. RLS restricts writes to id = auth.uid(). */
export const profileRepository = {
  async removeAvatar(userId: string): Promise<void> {
    const { error } = await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]);
    if (error) throw toAppError(error);
  },
  /**
   * Uploads a JPEG avatar (passed as base64 from the image picker) to the public
   * `avatars` bucket under `<userId>/avatar.jpg` and returns its public URL. Storage RLS
   * only allows a user to write under their own uid folder. `upsert` lets a user replace
   * their photo. RN (Hermes) provides a global `atob`, so no base64 dependency is needed.
   */
  async uploadAvatar(userId: string, base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const path = `${userId}/avatar.jpg`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw toAppError(error);

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    // Bust the CDN cache so a replaced photo shows immediately.
    return `${data.publicUrl}?v=${Date.now()}`;
  },

  /**
   * Writes ONLY the photo column. The photo is saved the moment it is picked,
   * separately from the rest of the edit form, so this must not need a name,
   * an area or a sport list to go with it.
   */
  async setAvatarUrl(userId: string, avatarUrl: string | null): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  async getMine(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw toAppError(error);
    return data;
  },

  async create(input: CreateProfileInput): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: input.userId,
        full_name: input.fullName,
        area_name: input.areaName,
        sport_pref: input.sportPref,
        home_lat: input.homeLat ?? null,
        home_lng: input.homeLng ?? null,
        avatar_url: input.avatarUrl ?? null,
      })
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  /**
   * `avatarUrl` is deliberately three-valued: a string sets a new photo, `null`
   * clears it, and `undefined` means "not part of this edit" and must leave the
   * stored URL alone. Writing `input.avatarUrl ?? null` here would silently
   * erase the user's photo on every unrelated name or area change.
   */
  /**
   * Mute switches, keyed by notification GROUP rather than by kind — a new kind
   * falls into an existing group server-side and honours a choice the user
   * already made. Absent key means enabled, so only an explicit false mutes.
   * Merged rather than replaced so one toggle cannot clear the others.
   */
  async updateNotifPrefs(userId: string, prefs: Record<string, boolean>): Promise<Profile> {
    const { data: current, error: readError } = await supabase
      .from('profiles')
      .select('notif_prefs')
      .eq('id', userId)
      .single();
    if (readError) throw toAppError(readError);

    const merged = { ...((current?.notif_prefs as Record<string, boolean>) ?? {}), ...prefs };
    const { data, error } = await supabase
      .from('profiles')
      .update({ notif_prefs: merged })
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },

  async update(input: UpdateProfileInput): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName,
        area_name: input.areaName,
        sport_pref: input.sportPref,
        ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
        ...(input.homeLat !== undefined ? { home_lat: input.homeLat } : {}),
        ...(input.homeLng !== undefined ? { home_lng: input.homeLng } : {}),
      })
      .eq('id', input.userId)
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },
};
