/**
 * Lightweight SVG icon set for the redesigned screens. No icon library is
 * installed, so these are hand-drawn with react-native-svg. Each icon is a
 * 24x24 stroke glyph that inherits `color` and `size`.
 */
import Svg, { Path, Circle, Line, Rect, Polyline, Polygon } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

type G = (p: Required<IconProps>) => React.ReactNode;

function make(draw: G) {
  return function Icon({ size = 24, color = '#FFFFFF', strokeWidth = 2 }: IconProps): React.ReactNode {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {draw({ size, color, strokeWidth })}
      </Svg>
    );
  };
}

const s = (color: string, w: number) => ({
  stroke: color,
  strokeWidth: w,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export const IconBack = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="19" y1="12" x2="5" y2="12" {...s(color, w)} />
    <Polyline points="12 19 5 12 12 5" {...s(color, w)} />
  </>
));

export const IconHelp = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Path d="M9.2 9.2a2.8 2.8 0 1 1 4 2.6c-.9.5-1.5 1-1.5 2.1" {...s(color, w)} />
    <Circle cx="12" cy="17.2" r="0.6" fill={color} />
  </>
));

export const IconMenu = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="4" y1="7" x2="20" y2="7" {...s(color, w)} />
    <Line x1="4" y1="12" x2="20" y2="12" {...s(color, w)} />
    <Line x1="4" y1="17" x2="20" y2="17" {...s(color, w)} />
  </>
));

export const IconGear = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="3" {...s(color, w)} />
    <Path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
      {...s(color, w)}
    />
  </>
));

export const IconBell = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" {...s(color, w)} />
    <Path d="M13.7 21a2 2 0 0 1-3.4 0" {...s(color, w)} />
  </>
));

export const IconBolt = make(({ color, strokeWidth: w }) => (
  <Polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" {...s(color, w)} />
));

export const IconSearch = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="11" cy="11" r="7" {...s(color, w)} />
    <Line x1="21" y1="21" x2="16.5" y2="16.5" {...s(color, w)} />
  </>
));

export const IconPlus = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="12" y1="5" x2="12" y2="19" {...s(color, w)} />
    <Line x1="5" y1="12" x2="19" y2="12" {...s(color, w)} />
  </>
));

export const IconMinus = make(({ color, strokeWidth: w }) => (
  <Line x1="5" y1="12" x2="19" y2="12" {...s(color, w)} />
));

export const IconSend = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="22" y1="2" x2="11" y2="13" {...s(color, w)} />
    <Polygon points="22 2 15 22 11 13 2 9 22 2" {...s(color, w)} />
  </>
));

export const IconUser = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="8" r="4" {...s(color, w)} />
    <Path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...s(color, w)} />
  </>
));

export const IconCalendar = make(({ color, strokeWidth: w }) => (
  <>
    <Rect x="3.5" y="5" width="17" height="16" rx="2.5" {...s(color, w)} />
    <Line x1="3.5" y1="9.5" x2="20.5" y2="9.5" {...s(color, w)} />
    <Line x1="8" y1="3" x2="8" y2="6.5" {...s(color, w)} />
    <Line x1="16" y1="3" x2="16" y2="6.5" {...s(color, w)} />
  </>
));

export const IconClock = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Polyline points="12 7 12 12 16 14" {...s(color, w)} />
  </>
));

export const IconPin = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" {...s(color, w)} />
    <Circle cx="12" cy="10" r="2.6" {...s(color, w)} />
  </>
));

export const IconChevron = make(({ color, strokeWidth: w }) => (
  <Polyline points="9 6 15 12 9 18" {...s(color, w)} />
));

export const IconShieldCheck = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M12 3l7 3v5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3Z" {...s(color, w)} />
    <Polyline points="9 12 11 14 15 9.5" {...s(color, w)} />
  </>
));

export const IconEdit = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M12 20h8" {...s(color, w)} />
    <Path d="M16.5 3.5a2 2 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" {...s(color, w)} />
  </>
));

export const IconLogout = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" {...s(color, w)} />
    <Polyline points="10 17 15 12 10 7" {...s(color, w)} />
    <Line x1="15" y1="12" x2="3" y2="12" {...s(color, w)} />
  </>
));

export const IconSliders = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="4" y1="8" x2="20" y2="8" {...s(color, w)} />
    <Line x1="4" y1="16" x2="20" y2="16" {...s(color, w)} />
    <Circle cx="9" cy="8" r="2.2" {...s(color, w)} />
    <Circle cx="15" cy="16" r="2.2" {...s(color, w)} />
  </>
));

export const IconDirections = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M12 2.5 21.5 12 12 21.5 2.5 12 12 2.5Z" {...s(color, w)} />
    <Polyline points="11 9 14 12 11 15" {...s(color, w)} />
    <Path d="M14 12H9.5v2" {...s(color, w)} />
  </>
));

export const IconStar = make(({ color, strokeWidth: w }) => (
  <Polygon
    points="12 3 14.6 8.6 20.5 9.3 16 13.3 17.3 19.2 12 16 6.7 19.2 8 13.3 3.5 9.3 9.4 8.6 12 3"
    stroke={color}
    strokeWidth={w}
    strokeLinejoin="round"
    fill={color}
  />
));

/** A bat lying on the diagonal with a ball beside it. */
export const IconCricket = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M15 3l4 4-9 9-4-4 9-9z" {...s(color, w)} />
    <Line x1="8" y1="14" x2="3.5" y2="18.5" {...s(color, w)} />
    <Circle cx="18.5" cy="17.5" r="2.3" {...s(color, w)} />
  </>
));

/** A shuttlecock: cork at the bottom-left, feathers fanning up and right. */
export const IconBadminton = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="6.6" cy="17.4" r="2.7" {...s(color, w)} />
    <Path d="M7.6 14.8 11 5c3.6.6 7.2 4.2 8 8l-9.8 3.4" {...s(color, w)} />
    <Line x1="8.8" y1="15.2" x2="15.6" y2="8.4" {...s(color, w)} />
  </>
));

export const IconFootball = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Polygon points="12 8.5 15 10.7 13.9 14.3 10.1 14.3 9 10.7 12 8.5" {...s(color, w)} />
    <Path d="M12 3.2v3M4.7 9.5l2.6 1.7M19.3 9.5l-2.6 1.7M7.4 19.5l1.6-2.6M16.6 19.5l-1.6-2.6" {...s(color, w)} />
  </>
));

export const IconBasketball = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Line x1="3" y1="12" x2="21" y2="12" {...s(color, w)} />
    <Line x1="12" y1="3" x2="12" y2="21" {...s(color, w)} />
    <Path d="M5.5 5.5C8 8 8 16 5.5 18.5M18.5 5.5C16 8 16 16 18.5 18.5" {...s(color, w)} />
  </>
));

export const IconClose = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="6" y1="6" x2="18" y2="18" {...s(color, w)} />
    <Line x1="18" y1="6" x2="6" y2="18" {...s(color, w)} />
  </>
));

/**
 * Theme toggle glyphs. IconGear is a circle with radiating spokes and reads as
 * a sun at small sizes, so these are deliberately distinct: the sun has a
 * smaller core with longer rays, and the moon is a solid crescent.
 */
export const IconSun = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="4.2" {...s(color, w)} />
    <Path
      d="M12 1.8v2.4M12 19.8v2.4M3.5 3.5l1.7 1.7M18.8 18.8l1.7 1.7M1.8 12h2.4M19.8 12h2.4M3.5 20.5l1.7-1.7M18.8 5.2l1.7-1.7"
      {...s(color, w)}
    />
  </>
));

export const IconMoon = make(({ color, strokeWidth: w }) => (
  <Path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" {...s(color, w)} />
));

export const IconHome = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M3.2 10.4 12 3.4l8.8 7v9.2a1.4 1.4 0 0 1-1.4 1.4H4.6a1.4 1.4 0 0 1-1.4-1.4z" {...s(color, w)} />
    <Path d="M9.2 21V12.6h5.6V21" {...s(color, w)} />
  </>
));

export const IconUsers = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M16.2 20.4v-1.8a3.6 3.6 0 0 0-3.6-3.6H6a3.6 3.6 0 0 0-3.6 3.6v1.8" {...s(color, w)} />
    <Circle cx="9.3" cy="7.6" r="3.4" {...s(color, w)} />
    <Path d="M21.6 20.4v-1.8a3.6 3.6 0 0 0-2.7-3.5M15.6 4.4a3.6 3.6 0 0 1 0 6.9" {...s(color, w)} />
  </>
));

export const IconCamera = make(({ color, strokeWidth: w }) => (
  <>
    <Path
      d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
      {...s(color, w)}
    />
    <Circle cx="12" cy="13" r="4" {...s(color, w)} />
  </>
));

export const IconCreateTeam = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M14.5 19v-1.5a3 3 0 0 0-3-3H5.5a3 3 0 0 0-3 3V19" {...s(color, w)} />
    <Circle cx="8.5" cy="7.5" r="3" {...s(color, w)} />
    <Path d="M18.5 14.5v-1a2.5 2.5 0 0 0-2-2.45" {...s(color, w)} />
    <Path d="M14 4.8a2.5 2.5 0 0 1 0 4.9" {...s(color, w)} />
    <Circle cx="18" cy="17.5" r="3.5" fill={color} />
    <Line x1="18" y1="15.8" x2="18" y2="19.2" stroke="#4F46E5" strokeWidth={1.5} strokeLinecap="round" />
    <Line x1="16.3" y1="17.5" x2="19.7" y2="17.5" stroke="#4F46E5" strokeWidth={1.5} strokeLinecap="round" />
  </>
));

export const IconShieldStar = make(({ color, strokeWidth: w }) => (
  <>
    <Path
      d="M12 2.5L19.5 5.5V11.5C19.5 16.5 16 20.5 12 21.8C8 20.5 4.5 16.5 4.5 11.5V5.5L12 2.5Z"
      {...s(color, w)}
    />
    <Polygon
      points="12 7.2 13.4 10.1 16.5 10.5 14.2 12.7 14.8 15.8 12 14.3 9.2 15.8 9.8 12.7 7.5 10.5 10.6 10.1 12 7.2"
      fill={color}
      stroke={color}
      strokeWidth={0.5}
      strokeLinejoin="round"
    />
  </>
));

/**
 * A red cricket ball with its seam. Not a stroke glyph like the rest of this
 * file -- it is a filled object, so it takes no `color`.
 *
 * Added for the toss screen's BOWL FIRST button, which used the 🎳 bowling-pins
 * emoji. (searching.tsx still defines its own unused local copy; left alone.)
 */
export function IconCricketBall({ size = 24 }: { size?: number }): React.ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="50" cy="50" r="42" fill="#C62828" />
      <Circle cx="50" cy="50" r="42" fill="none" stroke="#7F1D1D" strokeWidth={3} />
      {/* Specular highlight, so it reads as a sphere rather than a flat disc. */}
      <Circle cx="36" cy="34" r="11" fill="#EF5350" opacity={0.55} />
      {/* Seam */}
      <Path d="M28 22 C44 40, 44 60, 28 78" fill="none" stroke="#F5F5F5" strokeWidth={3} strokeLinecap="round" />
      <Path d="M72 22 C56 40, 56 60, 72 78" fill="none" stroke="#F5F5F5" strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}

/** Two crossed swords: blade, cross-guard and grip for each. */
export const IconSwords = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="4.5" y1="4.5" x2="17" y2="17" {...s(color, w)} />
    <Line x1="14" y1="19" x2="19" y2="14" {...s(color, w)} />
    <Line x1="17" y1="17" x2="20" y2="20" {...s(color, w)} />
    <Line x1="19.5" y1="4.5" x2="7" y2="17" {...s(color, w)} />
    <Line x1="5" y1="14" x2="10" y2="19" {...s(color, w)} />
    <Line x1="7" y1="17" x2="4" y2="20" {...s(color, w)} />
  </>
));

export const IconTarget = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Circle cx="12" cy="12" r="5" {...s(color, w)} />
    <Circle cx="12" cy="12" r="1.5" fill={color} />
  </>
));

export const IconFlag = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" {...s(color, w)} />
    <Line x1="4" y1="22" x2="4" y2="15" {...s(color, w)} />
  </>
));

export const IconChevronDown = make(({ color, strokeWidth: w }) => (
  <Polyline points="6 9 12 15 18 9" {...s(color, w)} />
));

export const IconTrophy = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2" {...s(color, w)} />
    <Path d="M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" {...s(color, w)} />
    <Path d="M6 3h12v7a6 6 0 0 1-12 0V3z" {...s(color, w)} />
    <Path d="M12 16v4" {...s(color, w)} />
    <Path d="M8 20h8" {...s(color, w)} />
  </>
));


/* ------------------------------------------------------------------ *
 * Glyphs added for the emerald redesign (Oct 2026).
 * ------------------------------------------------------------------ */

export const IconArrowRight = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="5" y1="12" x2="19" y2="12" {...s(color, w)} />
    <Polyline points="12 5 19 12 12 19" {...s(color, w)} />
  </>
));

export const IconCheck = make(({ color, strokeWidth: w }) => (
  <Polyline points="5 12.5 10 17.5 19 7" {...s(color, w)} />
));

export const IconCheckCircle = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Polyline points="8 12.3 11 15.2 16 9.2" {...s(color, w)} />
  </>
));

export const IconGamepad = make(({ color, strokeWidth: w }) => (
  <>
    <Path
      d="M7.5 7h9a5 5 0 0 1 4.9 4l.9 4.6a2.4 2.4 0 0 1-4.2 2L16 15.5H8l-2.1 2.1a2.4 2.4 0 0 1-4.2-2L2.6 11a5 5 0 0 1 4.9-4Z"
      {...s(color, w)}
    />
    <Line x1="8" y1="9.8" x2="8" y2="12.8" {...s(color, w)} />
    <Line x1="6.5" y1="11.3" x2="9.5" y2="11.3" {...s(color, w)} />
    <Circle cx="15" cy="12" r="0.7" fill={color} />
    <Circle cx="17.3" cy="10.3" r="0.7" fill={color} />
  </>
));

export const IconBarChart = make(({ color, strokeWidth: w }) => (
  <>
    <Rect x="4" y="11" width="4" height="9" rx="1" {...s(color, w)} />
    <Rect x="10" y="4" width="4" height="16" rx="1" {...s(color, w)} />
    <Rect x="16" y="8" width="4" height="12" rx="1" {...s(color, w)} />
  </>
));

export const IconDoc = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M6.5 3h8l4 4v12a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" {...s(color, w)} />
    <Line x1="8.5" y1="10" x2="15.5" y2="10" {...s(color, w)} />
    <Line x1="8.5" y1="13.5" x2="15.5" y2="13.5" {...s(color, w)} />
    <Line x1="8.5" y1="17" x2="13" y2="17" {...s(color, w)} />
  </>
));

export const IconInfo = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Line x1="12" y1="11" x2="12" y2="16.5" {...s(color, w)} />
    <Circle cx="12" cy="7.8" r="0.8" fill={color} />
  </>
));

export const IconCrown = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M3.5 8.5 7.5 12 12 5.5 16.5 12l4-3.5-1.6 9h-13.8l-1.6-9Z" {...s(color, w)} />
    <Line x1="5.5" y1="20.5" x2="18.5" y2="20.5" {...s(color, w)} />
  </>
));

/** Broadcast mark: a dot between two pairs of arcs. Used for "Live". */
export const IconLive = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="1.8" fill={color} />
    <Path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" {...s(color, w)} />
    <Path d="M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" {...s(color, w)} />
  </>
));

export const IconUndo = make(({ color, strokeWidth: w }) => (
  <>
    <Polyline points="8 4 4 8 8 12" {...s(color, w)} />
    <Path d="M4 8h10a6 6 0 0 1 0 12H8" {...s(color, w)} />
  </>
));

/** Three stumps with bails. */
export const IconWicket = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="7" y1="7" x2="7" y2="21" {...s(color, w)} />
    <Line x1="12" y1="7" x2="12" y2="21" {...s(color, w)} />
    <Line x1="17" y1="7" x2="17" y2="21" {...s(color, w)} />
    <Line x1="6" y1="4" x2="11" y2="4" {...s(color, w)} />
    <Line x1="13" y1="4" x2="18" y2="4" {...s(color, w)} />
  </>
));

export const IconHourglass = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="6" y1="3" x2="18" y2="3" {...s(color, w)} />
    <Line x1="6" y1="21" x2="18" y2="21" {...s(color, w)} />
    <Path d="M7.5 3v3.5c0 2 4.5 3.7 4.5 5.5s-4.5 3.5-4.5 5.5V21" {...s(color, w)} />
    <Path d="M16.5 3v3.5c0 2-4.5 3.7-4.5 5.5s4.5 3.5 4.5 5.5V21" {...s(color, w)} />
  </>
));

/** Isometric cube -- a bookable box / court. */
export const IconBox = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M12 2.8 20 7.2v9.6l-8 4.4-8-4.4V7.2l8-4.4Z" {...s(color, w)} />
    <Polyline points="4 7.2 12 11.6 20 7.2" {...s(color, w)} />
    <Line x1="12" y1="11.6" x2="12" y2="21.2" {...s(color, w)} />
  </>
));

export const IconInbox = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M3 13.5 5.8 6.2A2 2 0 0 1 7.7 5h8.6a2 2 0 0 1 1.9 1.2L21 13.5v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5Z" {...s(color, w)} />
    <Path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" {...s(color, w)} />
  </>
));

export const IconUserPlus = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="9.5" cy="8" r="3.6" {...s(color, w)} />
    <Path d="M2.8 20a6.7 6.7 0 0 1 13.4 0" {...s(color, w)} />
    <Line x1="19" y1="8" x2="19" y2="14" {...s(color, w)} />
    <Line x1="16" y1="11" x2="22" y2="11" {...s(color, w)} />
  </>
));

/** GPS reticle -- "use my current location". */
export const IconCrosshair = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="6.5" {...s(color, w)} />
    <Circle cx="12" cy="12" r="2" fill={color} />
    <Line x1="12" y1="2.5" x2="12" y2="5.5" {...s(color, w)} />
    <Line x1="12" y1="18.5" x2="12" y2="21.5" {...s(color, w)} />
    <Line x1="2.5" y1="12" x2="5.5" y2="12" {...s(color, w)} />
    <Line x1="18.5" y1="12" x2="21.5" y2="12" {...s(color, w)} />
  </>
));

export const IconNavArrow = make(({ color, strokeWidth: w }) => (
  <Polygon points="20.5 3.5 3.5 10.5 10.5 13.5 13.5 20.5 20.5 3.5" stroke={color} strokeWidth={w} strokeLinejoin="round" fill={color} />
));

export const IconBulb = make(({ color, strokeWidth: w }) => (
  <>
    <Path d="M8.5 14.5a6 6 0 1 1 7 0c-.7.6-1 1.3-1 2.2v.3h-5v-.3c0-.9-.3-1.6-1-2.2Z" {...s(color, w)} />
    <Line x1="10" y1="20.5" x2="14" y2="20.5" {...s(color, w)} />
  </>
));

export const IconGrid = make(({ color, strokeWidth: w }) => (
  <>
    <Rect x="4" y="4" width="6.5" height="6.5" rx="1.5" {...s(color, w)} />
    <Rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" {...s(color, w)} />
    <Rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" {...s(color, w)} />
    <Rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" {...s(color, w)} />
  </>
));

export const IconSort = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="8" y1="5" x2="8" y2="19" {...s(color, w)} />
    <Polyline points="5 8 8 5 11 8" {...s(color, w)} />
    <Line x1="16" y1="5" x2="16" y2="19" {...s(color, w)} />
    <Polyline points="13 16 16 19 19 16" {...s(color, w)} />
  </>
));

/** A coin seen face-on, for the Toss tab. */
export const IconCoin = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="12" cy="12" r="9" {...s(color, w)} />
    <Path d="M6.5 8.5c3.5 1 7.5 1 11 0M5.5 14c4 1.8 9 1.8 13 0" {...s(color, w)} />
  </>
));
