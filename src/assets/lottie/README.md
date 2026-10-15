# Lottie animations

Animations played through `<LottieAnim name="…" />` (`src/shared/ui/LottieAnim.tsx`).

## Expected files

| File | Name | Intended use | Loop |
|---|---|---|---|
| `success.json` | `success` | A completed action: booking confirmed, profile saved | no |
| `loading.json` | `loading` | A wait longer than a spinner deserves | yes |
| `empty.json` | `empty` | Empty lists: no matches, no offers, no bookings | yes |
| `match-found.json` | `match-found` | The radar found an opponent | no |
| `confetti.json` | `confetti` | Match confirmed, match won | no |

None of these are in the repo yet. Until a file is added and registered,
`<LottieAnim>` renders nothing for that name — no crash, no placeholder.

## Adding a file

1. Download the **Lottie JSON** from LottieFiles (not `.lottie`, not GIF).
2. Save it in this folder under the exact name in the table.
3. Un-comment its line in `index.ts`.

Step 3 is required and must come after step 2. Metro resolves `require()` at
build time, so a registered file that is not on disk breaks the build.

## Adding a new animation name

Add the name to `LottieName` in `index.ts`, add its `require` line, and add a
row to the table above.

## Keeping them small

- Prefer files under 100 KB. Check the size on LottieFiles before downloading.
- Avoid animations that embed raster images (`"assets"` with base64 `"p"`
  entries): they are large and lose the point of a vector format.
- Check the licence. LottieFiles free animations are usable commercially under
  the Lottie Simple License; paid and marketplace files have their own terms.
