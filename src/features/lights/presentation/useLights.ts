import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { lightsRepository } from '@features/lights/data/lightsRepository';
import type { LightEventStatus, SetLightsPaidInput } from '@features/lights/domain/lightsSchema';

const venuesKey = ['lights', 'venues'] as const;
const bookingsKey = (venueId: string, dayIso: string) =>
  ['lights', venueId, 'bookings', dayIso] as const;
const courtsKey = (venueId: string) => ['lights', venueId, 'courts'] as const;
const staffKey = (venueId: string) => ['lights', venueId, 'staff'] as const;
const matchLightsKey = (matchId: string) => ['lights', 'match', matchId] as const;
const lightCourtsKey = ['lights', 'courts-with-lights'] as const;

/** Grounds the caller can run the counter for. Also decides whether the entry row shows. */
export function useMyLightVenues() {
  return useQuery({ queryKey: venuesKey, queryFn: () => lightsRepository.listMyVenues() });
}

/** Bookings on one local day. `day` is local midnight. */
export function useLightBookings(venueId: string | null, day: Date) {
  const dayIso = day.toISOString();
  return useQuery({
    queryKey: bookingsKey(venueId ?? 'none', dayIso),
    queryFn: () => {
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      return lightsRepository.listBookings(venueId as string, day, next);
    },
    enabled: Boolean(venueId),
  });
}

/** Courts with their device and last event; refreshes so staff see blinks land. */
export function useCourtDevices(venueId: string | null) {
  return useQuery({
    queryKey: courtsKey(venueId ?? 'none'),
    queryFn: () => lightsRepository.listCourts(venueId as string),
    enabled: Boolean(venueId),
    refetchInterval: 15000,
  });
}

export function useVenueStaff(venueId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: staffKey(venueId ?? 'none'),
    queryFn: () => lightsRepository.listStaff(venueId as string),
    enabled: enabled && Boolean(venueId),
  });
}

/**
 * Lights status on the scoreboard, for everyone on the match. Display only;
 * the database decides every ball. Rechecked every 30 s so watchers see the
 * booker's on/off and the slot ending.
 */
export function useMatchLights(matchId: string) {
  return useQuery({
    queryKey: matchLightsKey(matchId),
    queryFn: () => lightsRepository.getMatchLights(matchId),
    enabled: matchId.length > 0,
    refetchInterval: 30000,
  });
}

/** Courts with lights, keyed "venueId:court". Changes rarely. */
export function useLightCourts() {
  return useQuery({
    queryKey: lightCourtsKey,
    queryFn: async () => {
      const rows = await lightsRepository.listLightCourts();
      return {
        venues: new Set(rows.map((r) => r.venue_id)),
        courts: new Set(rows.map((r) => `${r.venue_id}:${r.court_number}`)),
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** The booker's on/off for their own booking. */
export function useSetBookingLights(matchId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bookingId, wanted }: { bookingId: string; wanted: boolean }) =>
      lightsRepository.setBookingLights(bookingId, wanted),
    onSuccess: () => {
      if (matchId) void qc.invalidateQueries({ queryKey: matchLightsKey(matchId) });
    },
  });
}

const TERMINAL = new Set(['sent', 'failed', 'expired', 'skipped']);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function useLightsActions(venueId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['lights', venueId ?? 'none'] });

  const setPaid = useMutation({
    mutationFn: (input: SetLightsPaidInput) => lightsRepository.setPaid(input),
    onSuccess: invalidate,
  });
  const revokePaid = useMutation({
    mutationFn: (bookingId: string) => lightsRepository.revokePaid(bookingId),
    onSuccess: invalidate,
  });
  const setEnabled = useMutation({
    mutationFn: ({ court, enabled }: { court: number; enabled: boolean }) =>
      lightsRepository.setDeviceEnabled(venueId as string, court, enabled),
    onSuccess: invalidate,
  });
  const setToken = useMutation({
    mutationFn: ({ court, token }: { court: number; token: string }) =>
      lightsRepository.setDeviceToken(venueId as string, court, token),
    onSuccess: invalidate,
  });
  const addStaff = useMutation({
    mutationFn: (phone: string) => lightsRepository.addStaff(venueId as string, phone),
    onSuccess: invalidate,
  });
  const removeStaff = useMutation({
    mutationFn: (userId: string) => lightsRepository.removeStaff(venueId as string, userId),
    onSuccess: invalidate,
  });

  /**
   * Queues a TEST event and follows it for up to ~8 seconds, so the button can
   * say whether ThingsBoard accepted it. "sent" means ThingsBoard took it; the
   * blink itself is the rule chain and the ESP32.
   */
  const testBlink = useMutation({
    mutationFn: async (court: number): Promise<LightEventStatus> => {
      const id = await lightsRepository.sendTestBlink(venueId as string, court);
      let last: LightEventStatus = { status: 'queued', error: null };
      for (let i = 0; i < 8; i += 1) {
        await wait(1000);
        const s = await lightsRepository.getEventStatus(id);
        if (s) last = s;
        if (TERMINAL.has(last.status)) break;
      }
      return last;
    },
    onSettled: invalidate,
  });

  return { setPaid, revokePaid, setEnabled, setToken, addStaff, removeStaff, testBlink };
}
