import { useState } from 'react';
import {
  View,
  TextInput,
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
import { useRouter } from 'expo-router';

import { useOtp } from '@features/auth/presentation/useOtp';
import { radius, spacing, typography } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppLogo } from '@shared/ui/AppLogo';
import { AppText } from '@shared/ui/AppText';

const { height: SCREEN_H } = Dimensions.get('window');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const STADIUM_BG = require('../../assets/images/login-screen.png') as number;

export default function LoginScreen(): React.ReactNode {
  const { isDark } = useTheme();
  const router = useRouter();
  const { loading, error, requestOtp } = useOtp();
  const [phone, setPhone] = useState('');

  const onContinue = async (): Promise<void> => {
    const phoneE164 = await requestOtp(phone);
    if (phoneE164) {
      router.push({ pathname: '/(auth)/verify-otp', params: { phone: phoneE164 } });
    }
  };

  // Darker overlay — same approach as verify-otp, no white card
  const overlayColors: [string, string, string, string] = isDark
    ? ['rgba(2,8,18,0.82)', 'rgba(2,8,18,0.55)', 'rgba(2,8,18,0.6)', 'rgba(2,8,18,0.88)']
    : ['rgba(5,20,5,0.78)', 'rgba(5,20,5,0.5)', 'rgba(5,20,5,0.55)', 'rgba(5,20,5,0.88)'];

  const inputBg = 'rgba(255,255,255,0.08)';
  const inputBorder = error ? '#EF5350' : 'rgba(255,255,255,0.18)';

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
            {/* Logo — floats on bg */}
            <View style={styles.logoArea}>
              <AppLogo width={180} />
              <AppText
                variant="caption"
                color="rgba(255,255,255,0.55)"
                style={{ letterSpacing: 4, marginTop: spacing.sm }}
              >
                PLAY · CONNECT · WIN
              </AppText>
            </View>

            {/* Get Started text — directly on bg */}
            <AppText
              variant="heading"
              color="#FFFFFF"
              style={{ marginBottom: spacing.xs }}
            >
              Get Started
            </AppText>
            <AppText
              variant="body"
              color="rgba(255,255,255,0.65)"
              style={{ marginBottom: spacing.lg }}
            >
              Enter your mobile number to find nearby players and book matches.
            </AppText>

            {/* Phone input — dark glass style */}
            <View style={styles.phoneRow}>
              <View style={[styles.prefix, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                <AppText variant="label" color="#FFFFFF">+91</AppText>
              </View>
              <TextInput
                style={[
                  styles.phoneInput,
                  { backgroundColor: inputBg, borderColor: inputBorder },
                ]}
                value={phone}
                onChangeText={setPhone}
                placeholder="10-digit mobile number"
                placeholderTextColor="rgba(255,255,255,0.35)"
                keyboardType="phone-pad"
                maxLength={13}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={onContinue}
              />
            </View>

            {error ? (
              <AppText variant="caption" color="#EF5350" style={{ marginBottom: spacing.sm }}>
                {error}
              </AppText>
            ) : null}

            <AppText
              variant="caption"
              color="rgba(255,255,255,0.45)"
              style={{ marginBottom: spacing.xl }}
            >
              We'll send a one-time SMS code to verify your number.
            </AppText>

            {/* CTA */}
            <Pressable
              onPress={onContinue}
              disabled={loading}
              style={({ pressed }) => [
                styles.ctaOuter,
                { opacity: loading ? 0.6 : pressed ? 0.88 : 1 },
              ]}
            >
              <LinearGradient
                colors={['#66BB6A', '#2E7D32']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaGradient}
              >
                <AppText variant="label" color="#FFFFFF" style={{ fontSize: 17 }}>
                  {loading ? 'Sending code…' : 'Send OTP  →'}
                </AppText>
              </LinearGradient>
            </Pressable>

            <View style={styles.footer}>
              <AppText variant="caption" color="rgba(255,255,255,0.45)" center>
                🔒  Secure mobile login
              </AppText>
              <AppText
                variant="caption"
                color="rgba(255,255,255,0.3)"
                center
                style={{ marginTop: spacing.md }}
              >
                You&apos;re one step away from the game
              </AppText>
            </View>
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
  logoArea: { alignItems: 'center', marginBottom: spacing.xl },
  phoneRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  prefix: {
    width: 60,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneInput: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    fontSize: typography.body.fontSize,
    color: '#FFFFFF',
  },
  ctaOuter: {
    borderRadius: 50,
    overflow: 'hidden',
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 10,
  },
  ctaGradient: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
  },
  footer: { marginTop: spacing.lg },
});
