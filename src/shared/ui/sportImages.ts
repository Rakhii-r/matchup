import type { Sport } from '@shared/types/database.types';

/**
 * The one place sport artwork is resolved.
 *
 * Home previously drew sports with the SVG glyph set, where IconBadminton is a
 * circle plus a diagonal line — it renders as a magnifying glass — while
 * Matches and Venues each kept their own copy of this photo map. Three screens,
 * three answers, one of them nonsense. Everything now imports from here.
 */
export const SPORT_IMAGE: Record<Sport, number> = {
  box_cricket: require('../../../assets/images/cricket.jpg') as number,
  badminton: require('../../../assets/images/badminton.jpg') as number,
};

/**
 * Venue artwork. A real uploaded photo wins; until an admin uploads one we fall
 * back to the venue's own sport rather than a grey placeholder, which is what
 * the Venues screen already did and why Home looked broken beside it.
 */
export function venueImage(venue: {
  image_url: string | null;
  sport_types: Sport[] | null;
}): { uri: string } | number {
  if (venue.image_url) return { uri: venue.image_url };
  const first = venue.sport_types?.[0];
  return (first && SPORT_IMAGE[first]) || SPORT_IMAGE.box_cricket;
}
