import React, {useMemo} from 'react';
import * as THREE from 'three';
import {AbsoluteFill, Img, staticFile, useVideoConfig} from 'remotion';
import {COLORS, FONT_FAMILY, GLOW_RADIUS_W, GLOW_STOPS, PAIRS, PairName, WEIGHTS, withAlpha} from '../brand';
import {useFilmTime} from '../FilmTime';
import {BEATS, TEXT, clamp01, easeCinema, envelope, progress, smoother} from '../timeline';
import {CameraPath} from '../world/cameraPath';
import {CAMERA_KEYS} from '../world/keyframes';
import {constellationCount} from '../world/features';
import {geoToVec3} from '../math/geo';
import {mulberry32} from '../math/random';
import {enter, exit, fadeDrift, lineReveal} from './anim';
import './fonts';

// Brand DOM layer over the WebGL film: typography, corner gradients, the Astana
// label, the final logo lockup and film grain. Everything is a pure function of
// film time; brand colours come only from src/brand.ts.

const MARGIN_X = 120;
const MARGIN_B = 128;
// Finale column: right of the planet glow, on the dark part of the brand gradient.
const FINALE_X = 740;

const font = (weight: number, size: number, extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: FONT_FAMILY,
  fontWeight: weight,
  fontSize: size,
  ...extra,
});

// ---------------------------------------------------------------- corner glow
// Brand gradient (PDF shading Sh0): light at the corner, dark at 63.8 %, black at
// the radius (1321 px @1920). Screen blend: black = no change, so the 3D shows through.
const Glow: React.FC<{pair: PairName; amount: number}> = ({pair, amount}) => {
  const {width} = useVideoConfig();
  if (amount <= 0.001) return null;
  const p = PAIRS[pair];
  const r = GLOW_RADIUS_W * width;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle ${r}px at 0% 100%, ${p.light} 0%, ${p.dark} ${GLOW_STOPS.mid * 100}%, ${COLORS.black} 100%)`,
        mixBlendMode: 'screen',
        opacity: amount,
      }}
    />
  );
};

// ---------------------------------------------------------------- text pieces
const Mask: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <div style={{overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em', ...style}}>{children}</div>
);

const Eyebrow: React.FC<{t: number; start: number; end: number; color: string; children: React.ReactNode}> = ({
  t, start, end, color, children,
}) => (
  <Mask>
    <div style={{...font(WEIGHTS.medium, 24, {letterSpacing: '0.16em', textTransform: 'uppercase', color, fontFeatureSettings: '"case" 1'}), ...lineReveal(t, start, end, 0.9)}}>
      {children}
    </div>
  </Mask>
);

// Brand "fading headline" (brandbook p. 29, 42-43): opaque at the top, fading down.
const fadeMask = (from = 0.42, to = 0.18): React.CSSProperties => ({
  WebkitMaskImage: `linear-gradient(to bottom, ${COLORS.black} ${from * 100}%, ${withAlpha(COLORS.black, to)} 100%)`,
  maskImage: `linear-gradient(to bottom, ${COLORS.black} ${from * 100}%, ${withAlpha(COLORS.black, to)} 100%)`,
});

const Headline: React.FC<{t: number; start: number; end: number; size: number; children: React.ReactNode; fade?: boolean}> = ({
  t, start, end, size, children, fade = true,
}) => (
  <Mask>
    <div
      style={{
        ...font(WEIGHTS.semibold, size, {lineHeight: 0.98, letterSpacing: '-0.04em', color: COLORS.white, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'}),
        ...(fade ? fadeMask() : {}),
        ...lineReveal(t, start, end),
      }}
    >
      {children}
    </div>
  </Mask>
);

const Lead: React.FC<{t: number; start: number; end: number; children: React.ReactNode; size?: number}> = ({
  t, start, end, children, size = 40,
}) => (
  <div style={{...font(WEIGHTS.regular, size, {lineHeight: 1.22, color: COLORS.light, maxWidth: 1100}), ...fadeDrift(t, start, end)}}>
    {children}
  </div>
);

const Block: React.FC<{children: React.ReactNode; gap?: number}> = ({children, gap = 18}) => (
  <div style={{position: 'absolute', left: MARGIN_X, bottom: MARGIN_B, display: 'flex', flexDirection: 'column', gap}}>
    {children}
  </div>
);

// Russian digit grouping with a no-break space ("2 015"): a bare "2015" reads as a year.
const ru = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

// ---------------------------------------------------------------- theses
const Theses: React.FC<{t: number}> = ({t}) => {
  const within = (w: {in: number; out: number}) => t > w.in - 0.1 && t < w.out + 0.1;
  const {t1, t2, t3, t4, t5, t6} = TEXT;
  return (
    <>
      {within(t1) && (
        <Block>
          <Eyebrow t={t} start={t1.in} end={t1.out} color={PAIRS.sky.light}>Масштаб по всей стране</Eyebrow>
          <Headline t={t} start={t1.in + 0.1} end={t1.out} size={196}>20</Headline>
          <Lead t={t} start={t1.in + 0.35} end={t1.out}>региональных IT-хабов</Lead>
        </Block>
      )}
      {within(t2) && (
        <Block gap={22}>
          <Eyebrow t={t} start={t2.in + 0.2} end={t2.out} color={PAIRS.blue.light}>Astana Hub</Eyebrow>
          <div>
            <Headline t={t} start={t2.in + 0.3} end={t2.out} size={104} fade={false}>Крупнейший технопарк</Headline>
            <div style={fadeMask(0.3, 0.25)}>
              <Headline t={t} start={t2.in + 0.45} end={t2.out} size={104} fade={false}>в Центральной Азии</Headline>
            </div>
          </div>
        </Block>
      )}
      {within(t3) && (
        <Block>
          <Eyebrow t={t} start={t3.in + 0.1} end={t3.out} color={PAIRS.violet.light}>2019 → 2025</Eyebrow>
          <Headline t={t} start={t3.in + 0.15} end={t3.out} size={196}>{ru(constellationCount(t))}</Headline>
          <Lead t={t} start={t3.in + 0.4} end={t3.out}>компаний-участников</Lead>
        </Block>
      )}
      {within(t4) && (
        <Block>
          <Eyebrow t={t} start={t4.in + 0.1} end={t4.out} color={PAIRS.purple.light}>Доход участников · 2025</Eyebrow>
          <Headline t={t} start={t4.in + 0.15} end={t4.out} size={196}>$1,7 млрд</Headline>
          <Lead t={t} start={t4.in + 0.5} end={t4.out}>в 48 раз больше, чем в 2019 году</Lead>
        </Block>
      )}
      {within(t5) && (
        <Block>
          <Eyebrow t={t} start={t5.in + 0.1} end={t5.out} color={PAIRS.sunset.light}>Экспортная выручка · 2025</Eyebrow>
          <Headline t={t} start={t5.in + 0.15} end={t5.out} size={196}>$634 млн</Headline>
          <Lead t={t} start={t5.in + 0.9} end={t5.out} size={34}>
            Международные хабы:
            <br />
            Пало-Альто · Шанхай · Дубай · Куала-Лумпур
          </Lead>
        </Block>
      )}
      {within(t6) && <Goals t={t} />}
    </>
  );
};

// Goals: one narrow column (number over label) so the camera's move into the
// finale, which slides the planet left from 74 s, never reaches the text.
const Goals: React.FC<{t: number}> = ({t}) => {
  const {t6} = TEXT;
  const items: [string, string][] = [
    ['10\u00a0000', 'ИИ-талантов'],
    ['3', 'единорога'],
    ['$2\u00a0млрд', 'экспорта технологий в\u00a0год'],
  ];
  return (
    <div style={{position: 'absolute', left: MARGIN_X, bottom: MARGIN_B, display: 'flex', flexDirection: 'column', gap: 30, width: 420}}>
      <Eyebrow t={t} start={t6.in + 0.1} end={t6.out} color={PAIRS.blue.light}>Цели к 2030 году</Eyebrow>
      {items.map(([num, label], i) => {
        const s = t6.in + 0.35 + i * 0.7;
        return (
          <div key={num} style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            <Headline t={t} start={s} end={t6.out} size={96}>{num}</Headline>
            <Lead t={t} start={s + 0.2} end={t6.out} size={32}>{label}</Lead>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------- Astana label
const useProjection = (t: number) => {
  const {width, height} = useVideoConfig();
  const path = useMemo(() => new CameraPath(CAMERA_KEYS), []);
  const cam = useMemo(() => new THREE.PerspectiveCamera(), []);
  path.apply(cam, t, width / height);
  return (lat: number, lon: number, r = 1.0022) => {
    const p = geoToVec3(lat, lon, r);
    const facing = p.clone().sub(cam.position).dot(p) < 0;
    const ndc = p.clone().project(cam);
    return {x: (ndc.x * 0.5 + 0.5) * width, y: (1 - (ndc.y * 0.5 + 0.5)) * height, visible: facing && ndc.z < 1};
  };
};

const AstanaLabel: React.FC<{t: number}> = ({t}) => {
  const project = useProjection(t);
  const {astanaLabel: w} = TEXT;
  if (t < w.in - 0.1 || t > w.out + 0.1) return null;
  const a = project(51.1811, 71.4278);
  if (!a.visible) return null;
  const e = enter(t, w.in, 0.9);
  const x = exit(t, w.out, 0.6);
  const lineLen = 70 * easeCinema(progress(t, w.in, w.in + 0.7));
  return (
    <div style={{position: 'absolute', left: a.x, top: a.y, opacity: x}}>
      <div style={{position: 'absolute', left: 14, top: -1, width: lineLen, height: 1.5, background: COLORS.white, opacity: 0.8}} />
      <div
        style={{
          position: 'absolute',
          left: 14 + 70 + 14,
          top: -17,
          ...font(WEIGHTS.medium, 26, {letterSpacing: '0.16em', color: COLORS.white, whiteSpace: 'nowrap'}),
          opacity: e,
          transform: `translate3d(${((1 - e) * 12).toFixed(3)}px, 0, 0)`,
        }}
      >
        АСТАНА
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- mission + logo
const Mission: React.FC<{t: number}> = ({t}) => {
  const w = TEXT.mission;
  if (t < w.in - 0.1 || t > w.out + 0.1) return null;
  const lines = ['Развитие технологических инноваций', 'для экономического роста', 'Республики Казахстан'];
  return (
    <div style={{position: 'absolute', left: FINALE_X, top: 360, display: 'flex', flexDirection: 'column'}}>
      {lines.map((l, i) => (
        <Mask key={l}>
          <div style={{...font(WEIGHTS.semibold, 54, {lineHeight: 1.14, letterSpacing: '-0.025em', color: COLORS.white, whiteSpace: 'nowrap'}), ...lineReveal(t, w.in + i * 0.14, w.out)}}>
            {l}
          </div>
        </Mask>
      ))}
    </div>
  );
};

// Logo lockup (brandbook p. 17-18): [sign + "astana hub"] | "Join the unicorn game".
// Proportions from the PDF: logo 663 x 139 px, gap to the slogan = logo height,
// slogan Inter Medium at 0.4586 x logo height, vertically centred.
const LOGO_SRC = 2000; // source image width (px)
const LOGO_H_SRC = 421;
const SIGN_END = 406 / LOGO_SRC;
const WORD_START = 544 / LOGO_SRC;

const LogoLockup: React.FC<{t: number}> = ({t}) => {
  if (t < BEATS.logo - 0.2) return null;
  const logoW = 480;
  const logoH = (logoW * LOGO_H_SRC) / LOGO_SRC; // 101 px
  const gap = logoH;
  const sloganSize = 0.4586 * logoH;
  const left = FINALE_X;
  const top = 470 - logoH / 2;

  const signIn = enter(t, BEATS.logo, 1.4);
  const wordIn = easeCinema(progress(t, BEATS.logo + 0.55, BEATS.logo + 1.6));
  const divIn = easeCinema(progress(t, BEATS.slogan - 0.2, BEATS.slogan + 0.4));
  const out = 1 - smoother(progress(t, BEATS.fadeOut, 89.6));

  // Brand base pattern (p. 9 / 24): concentric rings converge into the sign.
  const cx = left + (SIGN_END * logoW) / 2;
  const cy = top + logoH / 2;
  const ringP = easeCinema(progress(t, BEATS.logo - 0.3, BEATS.logo + 1.3));
  const greys = [COLORS.grey.g80, COLORS.grey.g70, COLORS.grey.g50, COLORS.grey.g30, COLORS.grey.g10];

  return (
    <AbsoluteFill style={{opacity: out}}>
      <svg width="100%" height="100%" style={{position: 'absolute', inset: 0}}>
        {greys.map((g, i) => {
          const r0 = 180 + i * 150;
          const r = r0 + (logoH * 0.5 - r0) * ringP;
          return (
            <circle key={g} cx={cx} cy={cy} r={Math.max(1, r)} fill="none" stroke={g} strokeWidth={1.5}
              opacity={(1 - ringP) * clamp01(progress(t, BEATS.logo - 0.3, BEATS.logo + 0.1)) * 0.9} />
          );
        })}
      </svg>
      <div style={{position: 'absolute', left, top, width: logoW, height: logoH}}>
        <Img
          src={staticFile('brand/logo_main_on_black.webp')}
          style={{
            position: 'absolute',
            inset: 0,
            width: logoW,
            height: logoH,
            clipPath: `inset(0 ${((1 - SIGN_END) * 100).toFixed(3)}% 0 0)`,
            opacity: signIn,
            transform: `scale(${(0.94 + 0.06 * signIn).toFixed(4)})`,
            transformOrigin: `${(SIGN_END * 50).toFixed(2)}% 50%`,
          }}
        />
        <Img
          src={staticFile('brand/logo_main_on_black.webp')}
          style={{
            position: 'absolute',
            inset: 0,
            width: logoW,
            height: logoH,
            clipPath: `inset(0 ${((1 - (WORD_START + (1 - WORD_START) * wordIn)) * 100).toFixed(3)}% 0 ${(WORD_START * 100 - 0.5).toFixed(3)}%)`,
            opacity: clamp01(wordIn * 3),
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          left: left + logoW + gap / 2 - 1,
          top: top + logoH * 0.2,
          width: 2,
          height: logoH * 0.6,
          background: COLORS.white,
          transform: `scaleY(${divIn.toFixed(4)})`,
          transformOrigin: '50% 50%',
        }}
      />
      <div style={{position: 'absolute', left: left + logoW + gap, top: top + logoH / 2 - sloganSize * 0.72, overflow: 'hidden', paddingBottom: 8}}>
        <div style={{...font(WEIGHTS.medium, sloganSize, {color: COLORS.white, whiteSpace: 'nowrap', letterSpacing: '-0.01em'}), ...lineReveal(t, BEATS.slogan, 999, 1.0)}}>
          Join the unicorn game
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- film grain
const useGrainTiles = () =>
  useMemo(() => {
    if (typeof document === 'undefined') return [] as string[];
    return [1, 2].map((seed) => {
      const size = 256;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      const img = ctx.createImageData(size, size);
      const rnd = mulberry32(seed * 7919);
      for (let i = 0; i < size * size; i++) {
        // Triangular distribution around mid-grey: film-like grain amplitude.
        const v = 128 + (rnd() + rnd() - 1) * 110;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    });
  }, []);

const Grain: React.FC<{t: number; amount: number}> = ({t, amount}) => {
  const tiles = useGrainTiles();
  const {fps} = useVideoConfig();
  const frame = Math.round(t * fps);
  const rnd = mulberry32(frame * 2654435761);
  if (!tiles.length) return null;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${tiles[0]}), url(${tiles[1]})`,
        backgroundSize: '256px 256px, 384px 384px',
        backgroundPosition: `${Math.floor(rnd() * 256)}px ${Math.floor(rnd() * 256)}px, ${Math.floor(rnd() * 384)}px ${Math.floor(rnd() * 384)}px`,
        mixBlendMode: 'overlay',
        opacity: amount,
        pointerEvents: 'none',
      }}
    />
  );
};

// ---------------------------------------------------------------- composition
const glowFor = (t: number): {pair: PairName; amount: number}[] => {
  const g = (pair: PairName, a: number, b: number, k = 0.5) => ({pair, amount: envelope(t, a, b, 1.2, 1.0) * k});
  return [
    g('sky', TEXT.t1.in - 0.4, TEXT.t1.out + 0.3, 0.42),
    g('blue', TEXT.t2.in - 0.3, TEXT.t2.out + 0.3, 0.5),
    g('violet', TEXT.t3.in - 0.3, TEXT.t3.out + 0.3, 0.5),
    g('purple', TEXT.t4.in - 0.3, TEXT.t4.out + 0.3, 0.48),
    g('sunset', TEXT.t5.in - 0.3, TEXT.t5.out + 0.3, 0.42),
    g('blue', TEXT.t6.in - 0.3, 90, 0.55),
  ];
};

export const Overlay: React.FC = () => {
  const t = useFilmTime();
  const finaleGlow = smoother(progress(t, 76, 81)) * (1 - 0.35 * smoother(progress(t, BEATS.logo - 0.5, BEATS.logo + 1.5)));
  const out = 1 - smoother(progress(t, BEATS.fadeOut, 89.6));
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {glowFor(t).map((g, i) => (
        <Glow key={i} pair={g.pair} amount={g.amount * (i === 5 ? 1 - 0.6 * smoother(progress(t, 75.5, 78)) : 1) * out} />
      ))}
      <Glow pair="blue" amount={finaleGlow * 0.62 * out} />
      <AstanaLabel t={t} />
      <Theses t={t} />
      <Mission t={t} />
      <LogoLockup t={t} />
      <Grain t={t} amount={0.07 * smoother(progress(t, 0.5, 2.5))} />
    </AbsoluteFill>
  );
};
