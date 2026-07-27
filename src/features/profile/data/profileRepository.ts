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
}

/** Reads/writes the current user's profile. RLS restricts writes to id = auth.uid(). */
export const profileRepository = {
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

  async update(input: UpdateProfileInput): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update({
        full_name: input.fullName,
        area_name: input.areaName,
        sport_pref: input.sportPref,
      })
      .eq('id', input.userId)
      .select('*')
      .single();
    if (error) throw toAppError(error);
    return data;
  },
};
