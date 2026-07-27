import { useState, useCallback } from 'react';

import { AppError } from '@core/errors/AppError';
import { analytics } from '@core/observability/analytics';
import { authRepository, type OtpChannel } from '@features/auth/data/authRepository';
import { normaliseIndianPhone } from '@features/auth/domain/phone';

interface UseOtp {
  loading: boolean;
  error: string | null;
  requestOtp: (rawPhone: string, channel?: OtpChannel) => Promise<string | null>;
  verifyOtp: (phoneE164: string, code: string, channel?: OtpChannel) => Promise<boolean>;
}

/**
 * View-hook for the OTP flow. Normalises the phone number, triggers/verifies the code,
 * and exposes loading/error for the screens. Returns the E.164 phone on success so the
 * verify screen can reuse it.
 */
export function useOtp(): UseOtp {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestOtp = useCallback(
    async (rawPhone: string, channel: OtpChannel = 'sms'): Promise<string | null> => {
    setError(null);
    const phoneE164 = normaliseIndianPhone(rawPhone);
    if (!phoneE164) {
      setError('Enter a valid 10-digit mobile number');
      return null;
    }
    setLoading(true);
    try {
      await authRepository.requestOtp(phoneE164, channel);
      analytics.capture('otp_requested', { channel });
      return phoneE164;
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not send the code. Try again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyOtp = useCallback(
    async (phoneE164: string, code: string, channel: OtpChannel = 'sms'): Promise<boolean> => {
    setError(null);
    setLoading(true);
    try {
      await authRepository.verifyOtp(phoneE164, code, channel);
      analytics.capture('otp_verified', { channel });
      return true;
    } catch (e) {
      // 'validation' covers GoTrue's otp_expired/invalid-token responses — give the
      // OTP-specific copy rather than the generic "some details are invalid" text.
      if (e instanceof AppError && e.code === 'validation') {
        setError('That code is invalid or has expired. Request a new one and try again.');
      } else {
        setError(e instanceof AppError ? e.message : 'Invalid or expired code.');
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, requestOtp, verifyOtp };
}
