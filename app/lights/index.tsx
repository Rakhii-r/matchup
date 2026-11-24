/**
 * Court Lights: the venue counter screen (Phase 2, docs/PHASE2_LIGHTS_DESIGN.md).
 *
 * - Courts: per-court kill switch, Test blink, and (superadmin) linking the
 *   court to its ThingsBoard device token.
 * - Bookings: mark a booking "Lights paid" after taking cash/UPI at the counter.
 *   Only a paid booking's holder, scoring during the slot, fires the lights.
 * - Staff (superadmin): who may run this screen for the venue.
 *
 * Every rule is enforced by the RPCs; this screen only shows and asks.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { useAuthStore } from '@core/auth/authStore';
import { AppError } from '@core/errors/AppError';
import {
  PAYMENT_METHODS,
  lightReasonLabel,
  type CourtDevice,
  type LightBooking,
  type PaymentMethod,
} from '@features/lights/domain/lightsSchema';
import {
  useCourtDevices,
  useLightBookings,
  useLightsActions,
  useMyLightVenues,
  useVenueStaff,
} from '@features/lights/presentation/useLights';
import { DateStrip } from '@features/venues/presentation/DateStrip';
import { formatDateIso } from '@features/venues/domain/slotUtils';
import { radius, spacing, type AppColors } from '@shared/theme';
import { useTheme } from '@shared/theme/ThemeContext';
import { AppText } from '@shared/ui/AppText';
import { Button } from '@shared/ui/Button';
import { Screen } from '@shared/ui/Screen';
import { TextField } from '@shared/ui/TextField';

type Styles = ReturnType<typeof makeStyles>;
type Actions = ReturnType<typeof useLightsActions>;

const METHOD_LABEL: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', comp: 'Free' };

function errorMessage(e: unknown): string {
  return e instanceof AppError ? e.message : 'Something went wrong. Try again.';
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** "YYYY-MM-DD" -> local midnight. */
function localMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export default function CourtLightsScreen(): React.ReactNode {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isSuperadmin = useAuthStore((s) => s.isSuperadmin);

  const venues = useMyLightVenues();
  const [pickedVenueId, setVenueId] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState(() => formatDateIso(new Date()));
  // Until one is picked, the first venue.
  const venueId = pickedVenueId ?? venues.data?.[0]?.id ?? null;

  const day = useMemo(() => localMidnight(dateStr), [dateStr]);
  const courts = useCourtDevices(venueId);
  const bookings = useLightBookings(venueId, day);
  const actions = useLightsActions(venueId);

  if (venues.isLoading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }
  if (venues.isError) {
    return (
      <Screen>
        <AppText variant="body" muted style={styles.empty}>
          {errorMessage(venues.error)}
        </AppText>
        <Button label="Retry" variant="secondary" onPress={() => void venues.refetch()} />
      </Screen>
    );
  }
  if ((venues.data ?? []).length === 0) {
    return (
      <Screen>
        <AppText variant="body" muted style={styles.empty}>
          You are not staff at any ground. Ask an admin to add your phone number.
        </AppText>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {(venues.data ?? []).length > 1 ? (
        <View style={styles.chips}>
          {(venues.data ?? []).map((v) => (
            <Pressable
              key={v.id}
              onPress={() => setVenueId(v.id)}
              style={[styles.chip, v.id === venueId && styles.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: v.id === venueId }}
            >
              <AppText
                variant="caption"
                color={v.id === venueId ? colors.textInverse : colors.text}
                style={{ fontWeight: '700' }}
              >
                {v.name}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : (
        <AppText variant="heading" style={styles.venueTitle}>
          {venues.data?.[0]?.name}
        </AppText>
      )}

      {/* ---------------- Courts ---------------- */}
      <AppText variant="caption" muted style={styles.sectionHeader}>
        COURTS
      </AppText>
      {courts.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {courts.isError ? (
        <AppText variant="caption" color={colors.danger}>
          {errorMessage(courts.error)}
        </AppText>
      ) : null}
      {(courts.data ?? []).map((c) => (
        <CourtCard
          key={c.court_number}
          court={c}
          isSuperadmin={isSuperadmin}
          actions={actions}
          styles={styles}
          colors={colors}
        />
      ))}

      {/* ---------------- Bookings ---------------- */}
      <AppText variant="caption" muted style={styles.sectionHeader}>
        BOOKINGS
      </AppText>
      <DateStrip selectedDate={dateStr} onSelectDate={setDateStr} daysCount={7} />
      {bookings.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {bookings.isError ? (
        <AppText variant="caption" color={colors.danger}>
          {errorMessage(bookings.error)}
        </AppText>
      ) : null}
      {bookings.isSuccess && bookings.data.length === 0 ? (
        <AppText variant="caption" muted style={styles.empty}>
          No bookings on this day.
        </AppText>
      ) : null}
      {(bookings.data ?? []).map((b) => (
        <BookingCard
          key={b.booking_id}
          booking={b}
          loadedAt={bookings.dataUpdatedAt}
          actions={actions}
          styles={styles}
          colors={colors}
        />
      ))}

      {isSuperadmin && venueId ? (
        <StaffSection venueId={venueId} actions={actions} styles={styles} colors={colors} />
      ) : null}
    </Screen>
  );
}

// ------------------------------------------------------------------ courts --

function CourtCard({
  court,
  isSuperadmin,
  actions,
  styles,
  colors,
}: {
  court: CourtDevice;
  isSuperadmin: boolean;
  actions: Actions;
  styles: Styles;
  colors: AppColors;
}): React.ReactNode {
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const testing = actions.testBlink.isPending && actions.testBlink.variables === court.court_number;
  const toggling = actions.setEnabled.isPending && actions.setEnabled.variables?.court === court.court_number;

  const onToggle = (enabled: boolean) =>
    actions.setEnabled.mutate(
      { court: court.court_number, enabled },
      { onError: (e) => Alert.alert('Could not switch lights', errorMessage(e)) },
    );

  const onTest = () => {
    setTestResult(null);
    actions.testBlink.mutate(court.court_number, {
      onSuccess: (s) =>
        setTestResult(
          s.status === 'sent'
            ? 'Sent to ThingsBoard. The lights should blink now.'
            : s.status === 'queued' || s.status === 'sending'
              ? 'Still sending. Check the court in a moment.'
              : `Not sent: ${lightReasonLabel(s.error) ?? s.status}`,
        ),
      onError: (e) => setTestResult(errorMessage(e)),
    });
  };

  const onSaveToken = () =>
    actions.setToken.mutate(
      { court: court.court_number, token },
      {
        onSuccess: () => {
          setEditing(false);
          setToken('');
        },
        onError: (e) => Alert.alert('Could not link device', errorMessage(e)),
      },
    );

  const statusLine = !court.configured
    ? 'No device linked'
    : court.enabled
      ? 'Lights on'
      : 'Lights switched off';
  const last =
    court.last_at && court.last_event
      ? `Last: ${court.last_event} · ${court.last_status ?? ''} · ${ago(court.last_at)}` +
        (court.last_status !== 'sent' && court.last_error
          ? `\n${lightReasonLabel(court.last_error) ?? ''}`
          : '')
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" style={styles.cardTitle}>
            Court {court.court_number}
          </AppText>
          <AppText
            variant="caption"
            color={court.configured && court.enabled ? colors.success : colors.textMuted}
          >
            {statusLine}
          </AppText>
        </View>
        {court.configured ? (
          <Switch
            value={court.enabled}
            onValueChange={onToggle}
            disabled={toggling}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#FFFFFF"
            accessibilityLabel={`Court ${court.court_number} lights`}
          />
        ) : null}
      </View>

      {last ? (
        <AppText variant="caption" muted>
          {last}
        </AppText>
      ) : null}

      {court.configured && court.enabled ? (
        <Button label="Test blink" variant="secondary" loading={testing} onPress={onTest} />
      ) : null}
      {testResult ? (
        <AppText variant="caption" muted>
          {testResult}
        </AppText>
      ) : null}

      {isSuperadmin ? (
        editing ? (
          <View style={styles.form}>
            <TextField
              label="ThingsBoard device access token"
              value={token}
              onChangeText={setToken}
              placeholder="Device → Copy access token"
              maxLength={128}
              autoFocus
            />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="Save"
                  loading={actions.setToken.isPending}
                  disabled={token.trim().length === 0}
                  onPress={onSaveToken}
                />
              </View>
            </View>
          </View>
        ) : (
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={8}>
            <AppText variant="caption" color={colors.primary} style={{ fontWeight: '700' }}>
              {court.configured ? 'Change device token' : 'Link ThingsBoard device'}
            </AppText>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- bookings --

function BookingCard({
  booking,
  loadedAt,
  actions,
  styles,
  colors,
}: {
  booking: LightBooking;
  /** When the list was fetched. The server refuses a finished slot regardless. */
  loadedAt: number;
  actions: Actions;
  styles: Styles;
  colors: AppColors;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const finished = new Date(booking.end_time).getTime() <= loadedAt;

  const onConfirm = () => {
    const rupees = method === 'comp' ? 0 : Number.parseInt(amount, 10);
    if (!Number.isFinite(rupees) || rupees < 0) {
      Alert.alert('Enter the amount', 'How much did they pay for lights, in rupees?');
      return;
    }
    actions.setPaid.mutate(
      { bookingId: booking.booking_id, amountRupees: rupees, method },
      {
        onSuccess: () => {
          setOpen(false);
          setAmount('');
        },
        onError: (e) => Alert.alert('Could not mark paid', errorMessage(e)),
      },
    );
  };

  const onRevoke = () =>
    Alert.alert(
      'Remove lights?',
      `${booking.booker_name}'s lights will stop from the next ball.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            actions.revokePaid.mutate(booking.booking_id, {
              onError: (e) => Alert.alert('Could not remove', errorMessage(e)),
            }),
        },
      ],
    );

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" style={styles.cardTitle}>
            Court {booking.court_number} · {clock(booking.start_time)}–{clock(booking.end_time)}
          </AppText>
          <AppText variant="caption" muted>
            {booking.booker_name}
          </AppText>
        </View>
        {booking.lights_paid ? (
          <View style={styles.paidPill}>
            <AppText variant="caption" color={colors.success} style={{ fontWeight: '700' }}>
              Lights paid
              {booking.amount_paise ? ` ₹${Math.round(booking.amount_paise / 100)}` : ''}
              {booking.method ? ` · ${METHOD_LABEL[booking.method]}` : ''}
            </AppText>
          </View>
        ) : null}
      </View>

      {!booking.lights_wanted ? (
        <AppText variant="caption" color={colors.warning}>
          Booker switched lights off
        </AppText>
      ) : null}

      {finished ? (
        <AppText variant="caption" muted>
          Slot over
        </AppText>
      ) : booking.lights_paid ? (
        <Pressable onPress={onRevoke} accessibilityRole="button" hitSlop={8}>
          <AppText variant="caption" color={colors.danger} style={{ fontWeight: '700' }}>
            Remove lights
          </AppText>
        </Pressable>
      ) : open ? (
        <View style={styles.form}>
          <View style={styles.row}>
            {PAYMENT_METHODS.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                style={[styles.chip, method === m && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: method === m }}
              >
                <AppText
                  variant="caption"
                  color={method === m ? colors.textInverse : colors.text}
                  style={{ fontWeight: '700' }}
                >
                  {METHOD_LABEL[m]}
                </AppText>
              </Pressable>
            ))}
          </View>
          {method !== 'comp' ? (
            <TextField
              label="Amount (₹)"
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="200"
            />
          ) : null}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Confirm" loading={actions.setPaid.isPending} onPress={onConfirm} />
            </View>
          </View>
        </View>
      ) : (
        <Button label="Mark lights paid" variant="secondary" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

// ------------------------------------------------------------------- staff --

function StaffSection({
  venueId,
  actions,
  styles,
  colors,
}: {
  venueId: string;
  actions: Actions;
  styles: Styles;
  colors: AppColors;
}): React.ReactNode {
  const staff = useVenueStaff(venueId, true);
  const [phone, setPhone] = useState('');

  const onAdd = () =>
    actions.addStaff.mutate(phone, {
      onSuccess: () => setPhone(''),
      onError: (e) => Alert.alert('Could not add staff', errorMessage(e)),
    });

  return (
    <>
      <AppText variant="caption" muted style={styles.sectionHeader}>
        COUNTER STAFF (ADMIN)
      </AppText>
      <View style={styles.card}>
        {staff.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
        {staff.isError ? (
          <AppText variant="caption" color={colors.danger}>
            {errorMessage(staff.error)}
          </AppText>
        ) : null}
        {staff.isSuccess && staff.data.length === 0 ? (
          <AppText variant="caption" muted>
            No staff yet. Admins can always run this screen.
          </AppText>
        ) : null}
        {(staff.data ?? []).map((s) => (
          <View key={s.user_id} style={styles.rowBetween}>
            <AppText variant="body" style={{ flex: 1 }}>
              {s.full_name}
            </AppText>
            <Pressable
              onPress={() =>
                actions.removeStaff.mutate(s.user_id, {
                  onError: (e) => Alert.alert('Could not remove', errorMessage(e)),
                })
              }
              accessibilityRole="button"
              hitSlop={8}
            >
              <AppText variant="caption" color={colors.danger} style={{ fontWeight: '700' }}>
                Remove
              </AppText>
            </Pressable>
          </View>
        ))}
        <TextField
          label="Add by phone number"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={16}
          placeholder="98765 43210"
        />
        <Button
          label="Add staff"
          variant="secondary"
          loading={actions.addStaff.isPending}
          disabled={phone.replace(/\D/g, '').length < 10}
          onPress={onAdd}
        />
      </View>
    </>
  );
}

const makeStyles = (colors: AppColors) =>
  StyleSheet.create({
    venueTitle: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
    sectionHeader: {
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    empty: { textAlign: 'center', marginVertical: spacing.lg },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    card: {
      gap: spacing.sm,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: { fontSize: 16, fontWeight: '600' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    form: { gap: spacing.sm },
    paidPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.success,
    },
  });
