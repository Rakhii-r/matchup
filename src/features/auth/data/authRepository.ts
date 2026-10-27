import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';
import {
  registerForPushNotifications,
  unregisterForPushNotifications,
} from '@core/notifications/pushNotifications';

/**
 * Delivery channel for the OTP. 'whatsapp' routes through Twilio's WhatsApp sender
 * (cheaper + higher deliverability in India); 'sms' is the fallback. Delivery is handled
 * server-side by the configured provider; the client only triggers and verifies.
 */
export type OtpChannel = 'whatsapp' | 'sms';

/**
 * Phone-OTP authentication against Supabase Auth. Channel delivery is handled server-side
 * by the configured provider (dev: Twilio + WhatsApp/SMS sender; prod: MSG91/DLT).
 * Phone numbers must be E.164 (e.g. +9198XXXXXXXX).
 */
export const authRepository = {
  async requestOtp(phoneE164: string, channel: OtpChannel = 'sms'): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
      options: { channel },
    });
    if (error) {
      logger.warn('requestOtp failed', { error: error.message, channel });
      throw toAppError(error);
    }
  },

  async verifyOtp(
    phoneE164: string,
    token: string,
    channel: OtpChannel = 'sms',
  ): Promise<void> {
    const { error } = await supabase.auth.verifyOtp({
      phone: phoneE164,
      token,
      type: channel,
    });
    if (error) {
      logger.warn('verifyOtp failed', { error: error.message, channel });
      throw toAppError(error);
    }
  },

  async signOut(): Promise<void> {
    // Drop the push token first: unregister_device is scoped by auth.uid(), so
    // after signOut() there is no way to remove it and the next user of this
    // phone would receive the previous user's notifications.
    await unregisterForPushNotifications();

    const { error } = await supabase.auth.signOut();
    if (error) {
      // Still signed in, but the token was just dropped above. Put it back, or
      // this session receives no pushes until the app is restarted.
      void registerForPushNotifications();
      throw toAppError(error);
    }
  },

  /**
   * Permanently deletes the signed-in account (Play / App Store requirement).
   * delete_my_account erases personal data and the login server-side; match
   * records stay, shown as "Deleted player". See its migration for why it is
   * not a plain delete of the user row.
   */
  async deleteAccount(userId: string): Promise<void> {
    // The photo goes first: storage refuses deletes from SQL, and once the
    // RPC has run this user can no longer authenticate to remove it.
    const { error: photoError } = await supabase.storage
      .from('avatars')
      .remove([`${userId}/avatar.jpg`]);
    if (photoError) throw toAppError(photoError);

    const { error } = await supabase.rpc('delete_my_account');
    if (error) throw toAppError(error);

    // Local only: the server sessions are already gone, so a global sign-out
    // would fail with "session not found" and leave the app signed in.
    await supabase.auth.signOut({ scope: 'local' });
  },
};
