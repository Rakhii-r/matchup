/**
 * An open match's two sides are toss-time shell teams named
 * "<match name> · Side A" / "· Side B" (see perform_toss). The match name is
 * already on screen wherever a side is named, so only "Side A" is worth
 * showing; the full string is what made results read
 * "Box Cricket · Kukatpally… · Side A won". A real squad name passes through.
 */
export function sideName(name: string | null | undefined): string | null {
  if (!name) return null;
  const side = /·\s*(Side [AB])\s*$/.exec(name);
  return side?.[1] ?? name;
}
