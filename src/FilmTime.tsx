import React, {createContext, useContext} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';

// Film time in seconds. The main composition maps frame -> frame / fps; the
// preview composition maps frame -> an arbitrary list of times (contact sheets).
type TimeMap = ((frame: number, fps: number) => number) | null;
const Ctx = createContext<TimeMap>(null);

export const FilmTimeProvider: React.FC<{map: TimeMap; children: React.ReactNode}> = ({map, children}) => (
  <Ctx.Provider value={map}>{children}</Ctx.Provider>
);

export const useFilmTime = (): number => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const map = useContext(Ctx);
  return map ? map(frame, fps) : frame / fps;
};
