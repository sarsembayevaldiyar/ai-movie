import {clamp01, easeCinema, easeOutSoft, progress} from '../timeline';

// Motion language (docs/DECISIONS.md): entrances use one long soft ease-out,
// exits a short symmetric ease; nothing overshoots. Durations in seconds.
export const ENTER = 1.1;
export const EXIT = 0.7;

/** 0..1 entrance progress for an element appearing at `start`. */
export const enter = (t: number, start: number, dur = ENTER) => easeOutSoft(progress(t, start, start + dur));

/** 1..0 exit factor for an element leaving at `end`. */
export const exit = (t: number, end: number, dur = EXIT) => 1 - easeCinema(progress(t, end - dur, end));

/** Line reveal: the line rises from below its own box (use inside overflow: hidden). */
export const lineReveal = (t: number, start: number, end: number, dur = ENTER) => {
  const e = enter(t, start, dur);
  const x = exit(t, end);
  return {
    transform: `translate3d(0, ${((1 - e) * 105).toFixed(3)}%, 0)`,
    opacity: clamp01(e * 1.4) * x,
    filter: x < 1 ? `blur(${((1 - x) * 6).toFixed(3)}px)` : undefined,
  } as const;
};

/** Soft fade + drift used for secondary copy. */
export const fadeDrift = (t: number, start: number, end: number, drift = 18, dur = ENTER) => {
  const e = enter(t, start, dur);
  const x = exit(t, end);
  return {
    transform: `translate3d(0, ${((1 - e) * drift - (1 - x) * 10).toFixed(3)}px, 0)`,
    opacity: e * x,
  } as const;
};
