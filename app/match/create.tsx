import { useMemo, useState } from 'react';
import {
  ImageBackground,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { AppError } from '@core/errors/AppError';
import { useCreateMatch } from '@features/matches/presentation/useMatches';
import { CreateMatchSchema } from '@features/matches/domain/matchSchema';
import { useVenues } from '@features/venues/presentation/useVenues';
import type { Sport } from '@shared/types/database.types';
import { M, R, S } from '@shared/theme/mockTheme';
import { AppText } from '@shared/ui/AppText';
import {
  IconBack,
  IconCalendar,
  IconClock,
  IconClose,
  IconHelp,
  IconMinus,
  IconPlus,
  IconSend,
} from '@shared/ui/icons';

/* eslint-disable @typescript-eslint/no-require-imports */
const SPORTS: { key: Sport; label: string; image: number }[] = [
  { key: 'box_cricket', label: 'Cricket', image: require('../../assets/images/cricket.jpg') as number },
  { key: 'badminton', label: 'Badminton', image: require('../../assets/images/badminton.jpg') as number },
];
/* eslint-enable @typescript-eslint/no-require-imports */

/** Team format → total players on the sheet (both sides), per sport. */
const FORMATS_BY_SPORT: Record<Sport, { label: string; total: number }[]> = {
  box_cricket: [
    { label: '4 v 4', total: 8 },
    { label: '6 v 6', total: 12 },
    { label: '8 v 8', total: 16 },
    { label: '10 v 10', total: 20 },
  ],
  badminton: [
    { label: '1 v 1', total: 2 },
    { label: '2 v 2', total: 4 },
  ],
};

const OVERS = [4, 6, 8, 10, 12, 15];

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINUTES = [0, 15, 30, 45];

function labelForDay(offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

function to12h(hh: number, mm: number): string {
  const period = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${period}`;
}

function SectionLabel({ children }: { children: string }): React.ReactNode {
  return (
    <AppText variant="caption" color={M.faint} style={styles.sectionLabel}>
      {children}
    </AppText>
  );
}

function Chip({
  label,
  on,
  onPress,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
}): React.ReactNode {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <MotiView
        animate={{ backgroundColor: on ? M.green : M.card, borderColor: on ? M.green : M.border }}
        transition={{ type: 'timing', duration: 160 }}
        style={styles.chip}
      >
        <AppText variant="label" color={on ? '#06230F' : M.text}>
          {label}
        </AppText>
      </MotiView>
    </Pressable>
  );
}

export default function CreateMatchScreen(): React.ReactNode {
  const router = useRouter();
  const params = useLocalSearchParams<{ sport?: string }>();
  const create = useCreateMatch();
  const venues = useVenues();

  const preselected: Sport | null =
    params.sport === 'box_cricket' || params.sport === 'badminton' ? params.sport : null;

  const [sport, setSport] = useState<Sport | null>(preselected);
  const [matchName, setMatchName] = useState('');
  const [formatIdx, setFormatIdx] = useState<number | null>(null);
  const [overs, setOvers] = useState<number | null>(null);
  const [available, setAvailable] = useState(1);
  const [dayOffset, setDayOffset] = useState<number | null>(null);
  const [time, setTime] = useState<{ h: number; m: number } | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [showVenue, setShowVenue] = useState(false);

  const showSportPicker = preselected === null;
  const isCricket = sport === 'box_cricket';
  const FORMATS = FORMATS_BY_SPORT[sport ?? 'box_cricket'];
  const total = formatIdx !== null ? (FORMATS[formatIdx]?.total ?? 0) : 0;
  const needed = total > 0 ? Math.max(1, total - available) : 0;
  const availableVenues = useMemo(
    () => (venues.data ?? []).filter((item) => sport && item.sport_types.includes(sport)),
    [sport, venues.data],
  );
  const selectedVenue = availableVenues.find((item) => item.id === venueId) ?? null;
  const now = new Date();

  // Keep "available" inside [1, total-1] whenever the format changes.
  const clampAvailable = (next: number): number => {
    if (total === 0) return Math.max(1, next);
    return Math.min(Math.max(1, next), total - 1);
  };

  const timeHHmm = time ? `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}` : '';

  const validation = (() => {
    if (matchName.trim().length < 2) return { ok: false, msg: 'Enter a match name' };
    if (!sport) return { ok: false, msg: 'Pick a sport' };
    if (formatIdx === null) return { ok: false, msg: 'Choose a match format' };
    if (isCricket && overs === null) return { ok: false, msg: 'Choose the number of overs' };
    if (dayOffset === null) return { ok: false, msg: 'Pick a date' };
    if (!time) return { ok: false, msg: 'Pick a time' };
    if (!selectedVenue) return { ok: false, msg: 'Select a venue' };

    const composed = CreateMatchSchema.safeParse({
      matchName: matchName.trim(),
      sport,
      venueId: selectedVenue.id,
      dayOffset,
      timeHHmm,
      totalSlots: total,
      missingCount: needed,
      notes: notes.trim() || undefined,
    });
    if (!composed.success) {
      return { ok: false, msg: composed.error.issues[0]?.message ?? 'Check the form' };
    }
    // Guard against a past time when the chosen day is today.
    if (dayOffset === 0) {
      const chosen = new Date();
      chosen.setHours(time.h, time.m, 0, 0);
      if (chosen.getTime() <= now.getTime()) return { ok: false, msg: 'Pick a time later today' };
    }
    return { ok: true, msg: '' };
  })();

  const onSubmit = async (): Promise<void> => {
    setError(null);
    if (!validation.ok || dayOffset === null || !sport) {
      setError(validation.msg);
      return;
    }
    // Overs + format are captured in the description so no schema change is needed.
    const meta: string[] = [`Format: ${FORMATS[formatIdx as number]?.label ?? ''}`];
    if (isCricket && overs !== null) meta.push(`${overs} overs`);
    const description = [meta.join(' · '), notes.trim()].filter(Boolean).join('\n');

    try {
      const match = await create.mutateAsync({
        matchName: matchName.trim(),
        sport,
        venueId: selectedVenue?.id ?? '',
        dayOffset,
        timeHHmm,
        totalSlots: total,
        missingCount: needed,
        notes: description || undefined,
      });
      router.replace({ pathname: '/match/[id]', params: { id: match.id } });
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not create the match. Please try again.');
    }
  };

  // Time picker restricts to the future when the selected day is today.
  const minHour = dayOffset === 0 ? now.getHours() : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={() => router.back()}>
          <IconBack color={M.text} />
        </Pressable>
        <AppText variant="heading" color={M.text}>
          Create Match
        </AppText>
        <IconHelp color={M.muted} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SectionLabel>MATCH NAME</SectionLabel>
        <TextInput
          value={matchName}
          onChangeText={setMatchName}
          placeholder="e.g. Sunday Box Cricket"
          placeholderTextColor={M.faint}
          style={styles.nameInput}
          maxLength={80}
          returnKeyType="done"
        />

        {/* Sport */}
        {showSportPicker ? (
          <>
            <SectionLabel>SELECT SPORT</SectionLabel>
            <View style={styles.grid}>
              {SPORTS.map(({ key, label, image }) => {
                const on = sport === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setSport(key);
                      setVenueId(null);
                      setOvers(null);
                      setFormatIdx(null);
                      setAvailable(1);
                    }}
                    style={styles.sportTileWrap}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <MotiView
                      animate={{ scale: on ? 1 : 0.96, borderColor: on ? M.green : M.border }}
                      transition={{ type: 'spring', damping: 14, stiffness: 180 }}
                      style={[styles.sportTile, on && styles.sportTileOn]}
                    >
                      <ImageBackground
                        source={image}
                        style={styles.sportImage}
                        imageStyle={{ borderRadius: 16 }}
                      >
                        <View style={styles.sportShade} />
                        <AppText variant="label" color={M.text} style={styles.sportLabel}>
                          {label}
                        </AppText>
                      </ImageBackground>
                    </MotiView>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <>
            <SectionLabel>SPORT</SectionLabel>
            <View style={styles.selectedSport}>
              <ImageBackground
                source={SPORTS.find((s) => s.key === sport)?.image}
                style={styles.selectedSportImg}
                imageStyle={{ borderRadius: 16 }}
              >
                <View style={styles.sportShade} />
                <AppText variant="label" color={M.text} style={styles.sportLabel}>
                  {SPORTS.find((s) => s.key === sport)?.label}
                </AppText>
              </ImageBackground>
            </View>
          </>
        )}

        {/* Match format */}
        <SectionLabel>MATCH FORMAT</SectionLabel>
        <View style={styles.chipRow}>
          {FORMATS.map((f, i) => (
            <Chip
              key={f.label}
              label={f.label}
              on={formatIdx === i}
              onPress={() => {
                setFormatIdx(i);
                setAvailable((a) => Math.min(Math.max(1, a), f.total - 1));
              }}
            />
          ))}
        </View>

        {/* Overs (cricket only) */}
        {isCricket ? (
          <>
            <SectionLabel>OVERS</SectionLabel>
            <View style={styles.chipRow}>
              {OVERS.map((o) => (
                <Chip
                  key={o}
                  label={`${o} Overs`}
                  on={overs === o}
                  onPress={() => setOvers(o)}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* Players */}
        <SectionLabel>PLAYERS</SectionLabel>
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <AppText variant="label" color={M.text}>
                Available players
              </AppText>
              <AppText variant="caption" color={M.muted}>
                {total > 0 ? `Team size ${total}` : 'Pick a format first'}
              </AppText>
            </View>
            <View style={styles.stepControl}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => setAvailable((a) => clampAvailable(a - 1))}
              >
                <IconMinus color={M.text} size={18} />
              </Pressable>
              <AppText variant="heading" color={M.text} style={{ minWidth: 28, textAlign: 'center' }}>
                {String(available)}
              </AppText>
              <Pressable
                style={[styles.stepBtn, styles.stepBtnOn]}
                onPress={() => setAvailable((a) => clampAvailable(a + 1))}
              >
                <IconPlus color="#06230F" size={18} />
              </Pressable>
            </View>
          </View>
          <View style={styles.neededRow}>
            <AppText variant="label" color={M.text}>
              Players needed
            </AppText>
            <View style={styles.neededPill}>
              <AppText variant="label" color={M.green}>
                {total > 0 ? needed : '—'}
              </AppText>
            </View>
          </View>
        </View>

        {/* Date & time */}
        <SectionLabel>DATE &amp; TIME</SectionLabel>
        <View style={styles.dtRow}>
          <Pressable style={styles.dtField} onPress={() => setShowDate(true)}>
            <AppText color={dayOffset === null ? M.muted : M.text}>
              {dayOffset === null ? 'Select date' : labelForDay(dayOffset)}
            </AppText>
            <IconCalendar color={M.muted} size={18} />
          </Pressable>
          <Pressable style={styles.dtField} onPress={() => setShowTime(true)}>
            <AppText color={time === null ? M.muted : M.text}>
              {time === null ? 'Select time' : to12h(time.h, time.m)}
            </AppText>
            <IconClock color={M.muted} size={18} />
          </Pressable>
        </View>

        {/* Venue */}
        <SectionLabel>VENUE</SectionLabel>
        <Pressable
          style={styles.searchField}
          onPress={() => {
            if (venues.isError) void venues.refetch();
            setShowVenue(true);
          }}
          disabled={!sport || venues.isLoading}
          accessibilityRole="button"
        >
          <View style={{ flex: 1 }}>
            <AppText color={selectedVenue ? M.text : M.muted}>
              {venues.isLoading
                ? 'Loading venues…'
                : selectedVenue?.name ?? (sport ? 'Select a venue' : 'Select a sport first')}
            </AppText>
            {selectedVenue?.address ? (
              <AppText variant="caption" color={M.muted}>{selectedVenue.address}</AppText>
            ) : null}
          </View>
          <AppText color={M.muted}>⌄</AppText>
        </Pressable>
        {venues.isError ? (
          <AppText variant="caption" color={M.danger} style={{ marginTop: S.sm }}>
            Could not load venues. Tap the field to retry.
          </AppText>
        ) : null}

        {/* Description */}
        <SectionLabel>DESCRIPTION</SectionLabel>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything players should know? (optional)"
          placeholderTextColor={M.faint}
          style={styles.textArea}
          multiline
          maxLength={280}
        />

        {error ? (
          <AppText variant="caption" color={M.danger} style={{ marginTop: S.sm }}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      {/* Sticky CTA */}
      <View style={styles.footer}>
        <Pressable
          disabled={!validation.ok || create.isPending}
          style={({ pressed }) => [
            styles.cta,
            { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: validation.ok ? 1 : 0.45 },
          ]}
          onPress={onSubmit}
          accessibilityRole="button"
        >
          <AppText variant="label" color="#06230F" style={{ fontSize: 16, marginRight: S.sm }}>
            {create.isPending ? 'Posting…' : 'Post Match'}
          </AppText>
          <IconSend color="#06230F" size={18} />
        </Pressable>
      </View>

      {/* Date picker modal */}
      <Modal transparent visible={showVenue} animationType="slide" onRequestClose={() => setShowVenue(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowVenue(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>Select venue</AppText>
            <Pressable hitSlop={10} onPress={() => setShowVenue(false)}>
              <IconClose color={M.muted} size={20} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {availableVenues.length === 0 ? (
              <AppText color={M.muted} style={{ paddingVertical: S.lg }}>
                No database venues support this sport yet.
              </AppText>
            ) : availableVenues.map((item) => {
              const on = item.id === venueId;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.pickerRow, on && styles.pickerRowOn]}
                  onPress={() => {
                    setVenueId(item.id);
                    setShowVenue(false);
                  }}
                >
                  <AppText variant="label" color={on ? M.green : M.text}>{item.name}</AppText>
                  {item.address ? <AppText variant="caption" color={M.muted}>{item.address}</AppText> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Date picker modal */}
      <Modal transparent visible={showDate} animationType="slide" onRequestClose={() => setShowDate(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowDate(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>
              Select date
            </AppText>
            <Pressable hitSlop={10} onPress={() => setShowDate(false)}>
              <IconClose color={M.muted} size={20} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 14 }, (_, i) => i).map((offset) => {
              const on = dayOffset === offset;
              return (
                <Pressable
                  key={offset}
                  style={[styles.pickerRow, on && styles.pickerRowOn]}
                  onPress={() => {
                    setDayOffset(offset);
                    setShowDate(false);
                  }}
                >
                  <AppText variant="label" color={on ? M.green : M.text}>
                    {labelForDay(offset)}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Time picker modal */}
      <Modal transparent visible={showTime} animationType="slide" onRequestClose={() => setShowTime(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowTime(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <AppText variant="heading" color={M.text}>
              Select time
            </AppText>
            <Pressable hitSlop={10} onPress={() => setShowTime(false)}>
              <IconClose color={M.muted} size={20} />
            </Pressable>
          </View>
          <View style={styles.timeCols}>
            <ScrollView style={styles.timeCol} showsVerticalScrollIndicator={false}>
              {Array.from({ length: 24 }, (_, h) => h).map((h) => {
                const disabled = h < minHour;
                const on = time?.h === h;
                return (
                  <Pressable
                    key={h}
                    disabled={disabled}
                    style={[styles.timeCell, on && styles.timeCellOn]}
                    onPress={() => setTime((t) => ({ h, m: t?.m ?? 0 }))}
                  >
                    <AppText color={disabled ? M.faint : on ? M.green : M.text}>
                      {String(h).padStart(2, '0')}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView style={styles.timeCol} showsVerticalScrollIndicator={false}>
              {MINUTES.map((m) => {
                const disabled =
                  dayOffset === 0 && time?.h === now.getHours() && m <= now.getMinutes();
                const on = time?.m === m;
                return (
                  <Pressable
                    key={m}
                    disabled={disabled}
                    style={[styles.timeCell, on && styles.timeCellOn]}
                    onPress={() => setTime((t) => ({ h: t?.h ?? minHour, m }))}
                  >
                    <AppText color={disabled ? M.faint : on ? M.green : M.text}>
                      {String(m).padStart(2, '0')}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <Pressable
            style={[styles.sheetCta, { opacity: time ? 1 : 0.45 }]}
            disabled={!time}
            onPress={() => setShowTime(false)}
          >
            <AppText variant="label" color="#06230F" style={{ fontSize: 15 }}>
              Done
            </AppText>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: M.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.md,
  },
  scroll: { paddingHorizontal: S.lg, paddingBottom: S.xl },
  sectionLabel: { letterSpacing: 1.2, marginTop: S.lg, marginBottom: S.sm, fontWeight: '700' },
  grid: { flexDirection: 'row', justifyContent: 'space-between' },
  sportTileWrap: { width: '48%' },
  sportTile: {
    height: 128,
    borderRadius: 18,
    backgroundColor: M.card,
    borderWidth: 2,
    borderColor: M.border,
    overflow: 'hidden',
  },
  sportTileOn: {
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 10,
  },
  selectedSport: { borderRadius: 18, overflow: 'hidden' },
  selectedSportImg: { height: 120, justifyContent: 'flex-end' },
  sportImage: { flex: 1, justifyContent: 'flex-end' },
  sportShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sportLabel: { paddingHorizontal: S.md, paddingBottom: S.sm + 2, fontSize: 16, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  chip: {
    paddingHorizontal: S.md,
    paddingVertical: S.sm + 2,
    borderRadius: R.pill,
    borderWidth: 1.5,
    minWidth: 72,
    alignItems: 'center',
  },
  card: {
    backgroundColor: M.card,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: M.border,
    padding: S.md,
    gap: S.md,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  neededRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: M.border,
    paddingTop: S.md,
  },
  neededPill: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  stepControl: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: M.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnOn: { borderColor: M.green, backgroundColor: M.green },
  dtRow: { flexDirection: 'row', gap: S.sm },
  dtField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 52,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 52,
  },
  nameInput: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    paddingHorizontal: S.md,
    minHeight: 52,
    color: M.text,
    fontSize: 15,
  },
  textArea: {
    backgroundColor: M.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
    padding: S.md,
    minHeight: 90,
    color: M.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.lg,
    backgroundColor: M.bg,
    borderTopWidth: 1,
    borderTopColor: M.border,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    backgroundColor: M.green,
    borderRadius: 18,
    shadowColor: M.green,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
  },
  sheetBackdrop: { flex: 1, backgroundColor: M.overlay },
  sheet: {
    backgroundColor: M.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: S.lg,
    borderTopWidth: 1,
    borderColor: M.border,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.md,
  },
  pickerRow: {
    paddingVertical: S.md,
    paddingHorizontal: S.md,
    borderRadius: R.md,
  },
  pickerRowOn: { backgroundColor: 'rgba(34,197,94,0.12)' },
  timeCols: { flexDirection: 'row', gap: S.md, height: 220 },
  timeCol: {
    flex: 1,
    backgroundColor: M.bg,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: M.border,
  },
  timeCell: { paddingVertical: S.sm + 2, alignItems: 'center', borderRadius: R.sm },
  timeCellOn: { backgroundColor: 'rgba(34,197,94,0.14)' },
  sheetCta: {
    marginTop: S.lg,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: M.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
