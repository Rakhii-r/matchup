import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';

interface OfflineScreenProps {
  /** Re-runs whatever failed. The button shows a spinner until it settles. */
  onRetry: () => Promise<void>;
}

/**
 * Full-screen cover for "we could not reach the server, and so do not know
 * whether you are signed in". It is an overlay rather than a route: the state
 * can arise on any screen, and the route underneath should still be there when
 * the connection comes back.
 */
export function OfflineScreen({ onRetry }: OfflineScreenProps): ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [retrying, setRetrying] = useState(false);

  const retry = (): void => {
    setRetrying(true);
    void onRetry().finally(() => setRetrying(false));
  };

  return (
    <View style={styles.container} accessibilityViewIsModal>
      <AppText variant="heading" center>
        Can&apos;t connect
      </AppText>
      <AppText variant="body" center style={styles.body}>
        Check your internet connection. You are still signed in — we just could not reach the
        server.
      </AppText>
      <Button label="Try again" onPress={retry} loading={retrying} />
    </View>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      zIndex: 9998, // one below AppSplash, which fades out over this
      backgroundColor: colors.background,
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    body: { marginTop: spacing.sm, marginBottom: spacing.xl },
  });
