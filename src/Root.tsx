import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';
import {FilmTimeProvider} from './FilmTime';
import {FILM_SECONDS} from './timeline';

export const FPS = 60;

// Preview: renders the film at an arbitrary list of times (one frame per time),
// used for contact sheets and QA stills without rendering whole ranges.
const Preview: React.FC<{times: number[]; hide?: string[]}> = ({times, hide}) => (
  <FilmTimeProvider map={(frame) => times[Math.min(frame, times.length - 1)]}>
    <Film hide={hide} muted />
  </FilmTimeProvider>
);

const DEFAULT_TIMES = [2, 8, 12, 14.5, 17, 21, 25, 29, 32, 35.5, 37, 40, 43, 48, 54, 60, 66, 72, 78, 85];

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Film"
      component={Film}
      durationInFrames={Math.round(FILM_SECONDS * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="Preview"
      component={Preview}
      durationInFrames={DEFAULT_TIMES.length}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{times: DEFAULT_TIMES, hide: [] as string[]}}
      calculateMetadata={({props}) => ({durationInFrames: props.times.length})}
    />
  </>
);
