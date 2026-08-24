/**
 * Shared chrome for the Create Match wizard (`app/match/create/`).
 *
 * Every step is the same shape — back affordance, "Step N of M" with a progress
 * bar, a scrolling body, and one primary action pinned to the bottom that stays
 * disabled until the step is valid. Keeping that in one place is what stops the
 * five route files drifting apart, and it is the only file that has to be
 * touched to restyle the whole flow.
 *
 * Colour comes from `useMock()` via `makeStyles(M)` memoised on `M`, per the
 * house pattern in `app/(tabs)/index.tsx`. There are no literal colours here.
 */
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Stack, useRouter } from 'expo-router';

import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import { IconBack } from '@shared/ui/icons';

/** Smallest comfortable tap target. Applied to every control in the wizard. */
export const TOUCH = 44;

interface WizardScreenProps {
  title: string;
  /** 1-based position of this step within the branch the user is on. */
  stepIndex: number;
  totalSteps: number;
  /** One line under the title saying what this step is for. */
  subtitle?: string;
  children: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled: boolean;
  primaryPending?: boolean;
  /** Shown just above the primary action; usually the last submit failure. */
  error?: string | null;
}

export function WizardScreen({
  title,
  stepIndex,
  totalSteps,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryPending = false,
  error = null,
}: WizardScreenProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const router = useRouter();

  const blocked = primaryDisabled || primaryPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Pressable
          // A deep link opens a step with nothing behind it, where back() is a
          // no-op and would leave the user stranded. Fall back to the tabs.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconBack color={M.text} />
        </Pressable>
        <View style={styles.headerText}>
          <AppText variant="heading" color={M.text}>
            {title}
          </AppText>
          <AppText variant="caption" color={M.muted}>
            {`Step ${stepIndex} of ${totalSteps}`}
          </AppText>
        </View>
        {/* Balances the back button so the title block stays put. */}
        <View style={styles.backBtn} />
      </View>

      <View
        style={styles.progress}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: totalSteps, now: stepIndex }}
        accessibilityLabel={`Step ${stepIndex} of ${totalSteps}`}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <MotiView
            key={i}
            animate={{ backgroundColor: i < stepIndex ? M.green : M.border }}
            transition={{ type: 'timing', duration: 180 }}
            style={styles.progressSegment}
          />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {subtitle ? (
          <AppText variant="body" color={M.muted} style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
        {children}
      </ScrollView>

      <View style={styles.footer}>
        {error ? (
          <AppText variant="caption" color={M.danger} style={styles.footerError}>
            {error}
          </AppText>
        ) : null}
        <Pressable
          disabled={blocked}
          onPress={onPrimary}
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
          style={({ pressed }) => [
            styles.cta,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: blocked ? 0.45 : 1 },
          ]}
        >
          {primaryPending ? <ActivityIndicator color={M.limeInk} style={styles.ctaSpinner} /> : null}
          <AppText variant="label" color={M.limeInk} style={styles.ctaLabel}>
            {primaryLabel}
          </AppText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/** All-caps field label, same treatment as the old single-page form. */
export function SectionLabel({ children }: { children: string }): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  return (
    <AppText variant="caption" color={M.faint} style={styles.sectionLabel}>
      {children}
    </AppText>
  );
}

/** Pill toggle. 44pt tall so it clears the minimum touch target on its own. */
export function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <MotiView
        animate={{ backgroundColor: on ? M.green : M.card, borderColor: on ? M.green : M.border }}
        transition={{ type: 'timing', duration: 160 }}
        style={styles.chip}
      >
        <AppText variant="label" color={on ? M.limeInk : M.text}>
          {label}
        </AppText>
      </MotiView>
    </Pressable>
  );
}

/**
 * Loading / error / empty placeholder for the three data-driven steps. Every
 * one of them can legitimately return nothing — no venue hosts the sport, the
 * user owns no team — so each gets a stated reason and, where there is one, a
 * way out rather than a dead end.
 */
export function StepState({
  kind,
  message,
  actionLabel,
  onAction,
}: {
  kind: 'loading' | 'error' | 'empty';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);

  return (
    <View style={styles.stateBox}>
      {kind === 'loading' ? <ActivityIndicator color={M.green} /> : null}
      <AppText variant="body" color={kind === 'error' ? M.danger : M.muted} center>
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={styles.secondaryBtn}
          accessibilityRole="button"
        >
          <AppText variant="label" color={M.green}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: M.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      paddingBottom: S.sm,
    },
    backBtn: {
      width: TOUCH,
      height: TOUCH,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -S.sm,
    },
    headerText: { flex: 1, alignItems: 'center' },
    progress: { flexDirection: 'row', gap: S.xs, paddingHorizontal: S.lg, paddingBottom: S.md },
    progressSegment: { flex: 1, height: 4, borderRadius: R.pill, backgroundColor: M.border },
    scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
    subtitle: { marginBottom: S.md },
    sectionLabel: { letterSpacing: 1.2, marginTop: S.lg, marginBottom: S.sm, fontWeight: '700' },
    chip: {
      minHeight: TOUCH,
      paddingHorizontal: S.md,
      justifyContent: 'center',
      borderRadius: R.pill,
      borderWidth: 1.5,
      minWidth: 72,
      alignItems: 'center',
    },
    stateBox: {
      backgroundColor: M.card,
      borderRadius: R.lg,
      borderWidth: 1,
      borderColor: M.border,
      padding: S.lg,
      alignItems: 'center',
      gap: S.md,
      marginTop: S.md,
    },
    secondaryBtn: {
      minHeight: TOUCH,
      paddingHorizontal: S.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: R.pill,
      borderWidth: 1.5,
      borderColor: M.green,
    },
    footer: {
      paddingHorizontal: S.lg,
      paddingTop: S.sm,
      paddingBottom: S.md,
      backgroundColor: M.bg,
      borderTopWidth: 1,
      borderTopColor: M.border,
      gap: S.sm,
    },
    footerError: { textAlign: 'center' },
    cta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: S.sm,
      minHeight: 54,
      backgroundColor: M.green,
      borderRadius: 18,
      shadowColor: M.green,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 14,
      elevation: 8,
    },
    ctaSpinner: { marginRight: S.xs },
    ctaLabel: { fontSize: 16 },
  });
