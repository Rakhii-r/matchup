/**
 * Pick the squad that plays this fixture.
 *
 * A team can carry up to 20 players; a 4 v 4 seats four of them. This sheet is
 * where the captain says which four, and it is the only place that answer is
 * given — the server refuses a fixture whose squad is not exactly the format
 * size, so there is no path that skips it.
 *
 * EXACTLY N, not "at least N": the count is the format, and the Confirm button
 * stays dead until it is met. The running "3 / 4 selected" is deliberately the
 * most prominent thing on the sheet, because "why can't I continue" is the only
 * question this screen has to answer.
 *
 * The captain is pre-selected and cannot be removed. They are one of the N, not
 * an extra on top — `set_match_lineup` raises LINEUP_MISSING_CAPTAIN otherwise,
 * so letting them deselect here would only produce a refusal later.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTeamMembers } from '@features/teams/presentation/useTeams';
import { R, S, useMock, type MockPalette } from '@shared/theme/mockTheme';
import { useSheetInsets } from '@shared/theme/responsive';
import { AppText } from '@shared/ui/AppText';
import { IconClose, IconUsers } from '@shared/ui/icons';

interface LineupPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The team whose squad is being named. */
  teamId: string;
  teamName: string;
  /** The captain — always selected, never removable. */
  captainId: string;
  /** Players per side. The lineup must be exactly this long. */
  format: number;
  /** Disable the sheet while the accept/save request is in flight. */
  busy?: boolean;
  /** Called with exactly `format` user ids, captain included. */
  onConfirm: (userIds: string[]) => void;
  confirmLabel?: string;
  /** Pre-tick an existing lineup when re-picking. Captain is added regardless. */
  initialSelection?: string[];
}

export function LineupPickerSheet({
  visible,
  onClose,
  teamId,
  teamName,
  captainId,
  format,
  busy = false,
  onConfirm,
  confirmLabel = 'Confirm lineup',
  initialSelection,
}: LineupPickerSheetProps): React.ReactNode {
  const M = useMock();
  const styles = useMemo(() => makeStyles(M), [M]);
  const sheetInsets = useSheetInsets();
  const members = useTeamMembers(teamId);

  const [selected, setSelected] = useState<string[]>(() =>
    Array.from(new Set([captainId, ...(initialSelection ?? [])])),
  );

  const rows = members.data ?? [];
  const remaining = format - selected.length;
  const complete = selected.length === format;

  const toggle = (userId: string): void => {
    // The captain plays. Tapping their row is a no-op rather than a refusal,
    // because a disabled-looking row that does nothing is clearer than an alert.
    if (userId === captainId) return;
    setSelected((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId);
      // Hard stop at the format size: over-selecting then asking the captain to
      // remove someone is a worse flow than not accepting the tap.
      if (current.length >= format) return current;
      return [...current, userId];
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={[styles.sheet, sheetInsets]}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <AppText variant="heading" color={M.text}>
              {`Pick your ${format} v ${format} squad`}
            </AppText>
            <AppText variant="caption" color={M.muted} numberOfLines={1}>
              {teamName}
            </AppText>
          </View>
          <Pressable
            hitSlop={10}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <IconClose color={M.muted} size={20} />
          </Pressable>
        </View>

        {/* The count, stated once and loudly. */}
        <View style={[styles.counter, complete ? styles.counterDone : null]}>
          <AppText variant="label" color={complete ? M.green : M.text} center>
            {`${selected.length} / ${format} selected`}
          </AppText>
          <AppText variant="caption" color={complete ? M.green : M.muted} center>
            {complete
              ? 'Only these players are notified about this match.'
              : `Select ${remaining} more player${remaining === 1 ? '' : 's'} to continue.`}
          </AppText>
        </View>

        {members.isLoading ? (
          <AppText variant="caption" color={M.muted} style={styles.state}>
            Loading your squad…
          </AppText>
        ) : null}

        {members.isError ? (
          <AppText variant="caption" color={M.danger} style={styles.state}>
            Could not load your squad. Close and try again.
          </AppText>
        ) : null}

        {!members.isLoading && !members.isError && rows.length < format ? (
          <AppText variant="caption" color={M.danger} style={styles.state}>
            {`${teamName} has ${rows.length} player${rows.length === 1 ? '' : 's'} but needs ${format} for this fixture. Invite more players by code first.`}
          </AppText>
        ) : null}

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {rows.map((member) => {
            const isCaptain = member.user_id === captainId;
            const on = selected.includes(member.user_id);
            // Rows that cannot be added are dimmed rather than hidden: the
            // captain still needs to see who is on the bench.
            const atLimit = !on && selected.length >= format;

            return (
              <Pressable
                key={member.id}
                onPress={() => toggle(member.user_id)}
                disabled={isCaptain || busy}
                style={[styles.row, on ? styles.rowOn : null, atLimit ? styles.rowDim : null]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: isCaptain || atLimit }}
                accessibilityLabel={`${member.profile?.full_name ?? 'Player'}${isCaptain ? ', captain, always selected' : ''}`}
              >
                <View style={[styles.check, on ? styles.checkOn : null]}>
                  {on ? (
                    <AppText variant="caption" color={M.limeInk} style={styles.tick}>
                      ✓
                    </AppText>
                  ) : null}
                </View>
                <View style={styles.avatar}>
                  <IconUsers color={M.green} size={16} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="label" color={M.text} numberOfLines={1}>
                    {member.profile?.full_name ?? 'Player'}
                  </AppText>
                  <AppText variant="caption" color={M.muted} numberOfLines={1}>
                    {isCaptain ? 'Captain · always plays' : member.profile?.area_name ?? 'Squad member'}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          onPress={() => onConfirm(selected)}
          disabled={!complete || busy}
          style={[styles.cta, !complete || busy ? styles.ctaOff : null]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !complete || busy }}
        >
          <AppText variant="label" color={complete && !busy ? M.ctaText : M.muted}>
            {busy ? 'Confirming…' : complete ? confirmLabel : `Select ${remaining} more`}
          </AppText>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = (M: MockPalette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: M.overlay },
    sheet: {
      backgroundColor: M.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: S.lg,
      paddingTop: S.lg,
      borderTopWidth: 1,
      borderColor: M.border,
      gap: S.sm,
    },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm },
    counter: {
      padding: S.sm,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: M.border,
      backgroundColor: M.bg,
      gap: 2,
    },
    counterDone: { borderColor: M.green, backgroundColor: M.iconChip },
    state: { paddingVertical: S.sm },
    list: { maxHeight: 360 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: S.sm,
      paddingVertical: S.sm,
      paddingHorizontal: S.sm,
      borderRadius: R.md,
      borderWidth: 1,
      borderColor: 'transparent',
      minHeight: 56,
    },
    rowOn: { borderColor: M.green, backgroundColor: M.iconChip },
    rowDim: { opacity: 0.45 },
    check: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: M.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: { backgroundColor: M.green, borderColor: M.green },
    tick: { fontSize: 13, fontWeight: '800' },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: R.pill,
      backgroundColor: M.iconChip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cta: {
      minHeight: 52,
      borderRadius: R.md,
      backgroundColor: M.cta,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: S.xs,
    },
    ctaOff: { backgroundColor: M.chip },
  });
