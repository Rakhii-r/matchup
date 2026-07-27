import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ImageBackground,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Circle, Path } from 'react-native-svg';

import { useOtp } from '@features/auth/presentation/useOtp';
import { spacing } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';
import { OtpBoxInput } from '@shared/ui/OtpBoxInput';

const { height: SCREEN_H } = Dimensions.get('window');
const RESEND_SECONDS = 30;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const STADIUM_BG = require('../../assets/images/login-screen.png') as number;

export default function VerifyOtpScreen(): React.ReactNode {
  const { isDark } = useTheme();
  const params = useLocalSearchParams<{ phone?: string }>();
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const router = useRouter();
  const { loading, error, verifyOtp, requestOtp } = useOtp();
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    if (countdown <= 0) { setCanResend(true); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const onVerify = useCallback(async (): Promise<void> => {
    if (!phone || code.length !== 6) return;
    await verifyOtp(phone, code);
  }, [phone, code, verifyOtp]);

  useEffect(() => {
    if (code.length === 6) void onVerify();
  }, [code, onVerify]);

  const onResend = useCallback((): void => {
    if (!phone || !canResend) return;
    void requestOtp(phone);
    setCode('');
    setCountdown(RESEND_SECONDS);
    setCanResend(false);
  }, [phone, canResend, requestOtp]);

  const padded = phone.replace(/(\+91)(\d{5})(\d{5})/, '$1 $2 $3');

  // Darker overlay so text is readable without a card
  const overlayColors: [string, string, string, string] = isDark
    ? ['rgba(2,8,18,0.82)', 'rgba(2,8,18,0.55)', 'rgba(2,8,18,0.6)', 'rgba(2,8,18,0.88)']
    : ['rgba(5,20,5,0.78)', 'rgba(5,20,5,0.5)', 'rgba(5,20,5,0.55)', 'rgba(5,20,5,0.88)'];

  return (
    <SafeAreaView style={styles.safe}>
      <ImageBackground source={STADIUM_BG} style={styles.bg} resizeMode="cover">
        <LinearGradient
          colors={overlayColors}
          locations={[0, 0.3, 0.65, 1]}
          style={StyleSheet.absoluteFill}
        />

        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo — no card, floats on bg */}
            <View style={styles.logoArea}>
              <AppLogo width={160} />
              <AppText
                variant="caption"
                color="rgba(255,255,255,0.6)"
                style={{ letterSpacing: 4, marginTop: spacing.sm }}
              >
                PLAY . CONNECT . WIN
              </AppText>
            </View>

            {/* Title + subtitle — directly on dark bg */}
            <AppText
              variant="title"
              center
              color="#FFFFFF"
              style={styles.title}
            >
              Verify OTP
            </AppText>
            <AppText
              variant="body"
              center
              color="rgba(255,255,255,0.65)"
              style={{ marginBottom: spacing.xs }}
            >
              Please enter the One Time Password sent to
            </AppText>
            <AppText
              variant="heading"
              center
              color="#66BB6A"
              style={{ marginBottom: spacing.lg }}
            >
              {padded || 'your number'}
            </AppText>

            {/* OTP container — subtle dark box, matches reference */}
            <View style={styles.otpContainer}>
              <OtpBoxInput value={code} onChange={setCode} error={!!error} />

              {error ? (
                <AppText variant="caption" center color="#EF5350" style={{ marginTop: spacing.sm }}>
                  {error}
                </AppText>
              ) : null}

              <View style={styles.resendRow}>
                {canResend ? (
                  <Pressable onPress={onResend}>
                    <AppText variant="caption" color="#66BB6A">Resend OTP</AppText>
                  </Pressable>
                ) : (
                  <AppText variant="caption" color="rgba(255,255,255,0.6)">
                    Resend code available in{' '}
                    <AppText variant="caption" color="#66BB6A">
                      0:{String(countdown).padStart(2, '0')}
                    </AppText>
                  </AppText>
                )}
              </View>

              <View style={styles.secureBadge}>
                <AppText variant="caption" color="#66BB6A">⊙ Secure &amp; Encrypted</AppText>
              </View>
            </View>

            {/* Verify button */}
            <Pressable
              onPress={onVerify}
              disabled={code.length !== 6 || loading}
              style={({ pressed }) => [
                styles.ctaOuter,
                { opacity: code.length !== 6 || loading ? 0.5 : pressed ? 0.88 : 1 },
              ]}
            >
              <LinearGradient
                colors={['#66BB6A', '#2E7D32']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaGradient}
              >
                <AppText variant="label" color="#FFFFFF" style={{ fontSize: 17 }}>
                  {loading ? 'Verifying…' : 'Verify & Continue  ›'}
                </AppText>
                <View style={styles.ballWrap}>
                  <Svg width="34" height="34" viewBox="0 0 34 34">
                    <Circle cx="17" cy="17" r="16" fill="white" />
                    <Path d="M9 13 Q17 8 25 13" stroke="#2E7D32" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                    <Path d="M9 21 Q17 26 25 21" stroke="#2E7D32" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                  </Svg>
                </View>
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => router.back()} style={styles.changeNum}>
              <AppText variant="caption" color="rgba(255,255,255,0.6)" center>
                ✎  Change phone number
              </AppText>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050C19' },
  bg: { flex: 1, minHeight: SCREEN_H },
  kav: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'center',
  },
  logoArea: { alignItems: 'center', marginBottom: spacing.sm },
  title: { fontSize: 34, fontWeight: '800', marginBottom: spacing.sm },
  otpContainer: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    marginBottom: spacing.lg,
  },
  resendRow: { alignItems: 'center', marginTop: spacing.md },
  secureBadge: { alignItems: 'center', marginTop: spacing.sm },
  ctaOuter: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
  ctaGradient: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
    paddingHorizontal: spacing.xl,
  },
  ballWrap: { position: 'absolute', right: 10 },
  changeNum: { marginTop: spacing.lg, alignItems: 'center' },
});
