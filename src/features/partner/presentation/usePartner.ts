import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@core/auth/authStore';
import { partnerRepository } from '@features/partner/data/partnerRepository';
import type { VenueForm } from '@features/partner/domain/partnerSchema';

const myVenuesKey = ['partner', 'venues'] as const;
const ownersKey = ['partner', 'owners'] as const;

/** Venues the caller owns or staffs. */
export function useMyPartnerVenues() {
  return useQuery({ queryKey: myVenuesKey, queryFn: () => partnerRepository.listMyVenues() });
}

/** Admin only: owner names per venue. */
export function useVenueOwners() {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  return useQuery({
    queryKey: ownersKey,
    queryFn: () => partnerRepository.listOwners(),
    enabled: isAdmin,
  });
}

/**
 * Register, edit and assign. Every write refreshes the partner list and the
 * player-facing venue queries, since name, location and courts show there.
 */
export function usePartnerActions() {
  const qc = useQueryClient();
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['partner'] });
    void qc.invalidateQueries({ queryKey: ['venues'] });
    void qc.invalidateQueries({ queryKey: ['venue-slots'] });
  };

  const register = useMutation({
    mutationFn: (form: VenueForm) => partnerRepository.registerVenue(form),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async (input: {
      venueId: string;
      form: VenueForm;
      photoBase64: string | null;
    }) => {
      const imageUrl = input.photoBase64
        ? await partnerRepository.uploadCoverPhoto(input.venueId, input.photoBase64)
        : null;
      await partnerRepository.updateVenue(input.venueId, input.form, imageUrl);
    },
    onSuccess: refresh,
  });

  const assignOwner = useMutation({
    mutationFn: (input: { venueId: string; phone: string }) =>
      partnerRepository.assignOwner(input.venueId, input.phone),
    onSuccess: refresh,
  });

  return { register, update, assignOwner };
}
