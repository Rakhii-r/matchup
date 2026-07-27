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
    <Circle cx="12" cy="12" r="3.2" {...s(color, w)} />
    <Path
      d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"
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

export const IconCricket = make(({ color, strokeWidth: w }) => (
  <>
    <Line x1="5.5" y1="18.5" x2="15" y2="9" {...s(color, w)} />
    <Line x1="4.5" y1="19.5" x2="6.5" y2="17.5" {...s(color, w)} />
    <Circle cx="17.5" cy="6.5" r="2.4" {...s(color, w)} />
  </>
));

export const IconBadminton = make(({ color, strokeWidth: w }) => (
  <>
    <Circle cx="8" cy="8" r="4.5" {...s(color, w)} />
    <Line x1="11.3" y1="11.3" x2="19.5" y2="19.5" {...s(color, w)} />
    <Circle cx="20" cy="20" r="0.7" fill={color} />
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
