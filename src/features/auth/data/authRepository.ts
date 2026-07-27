import { supabase } from '@core/api/supabaseClient';
import { toAppError } from '@core/errors/AppError';
import { logger } from '@core/logging/logger';

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
    const { error } = await supabase.auth.signOut();
    if (error) throw toAppError(error);
  },
};
