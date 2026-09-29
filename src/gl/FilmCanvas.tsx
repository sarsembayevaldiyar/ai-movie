import {ThreeCanvas} from '@remotion/three';
import {useThree} from '@react-three/fiber';
import React, {useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import * as THREE from 'three';
import {useDelayRender, useVideoConfig} from 'remotion';
import {useFilmTime} from '../FilmTime';
import {FilmPipeline, PostParams} from './FilmPipeline';

// A World owns an imperative three.js scene whose entire state is a pure
// function of time. This is what makes shutter sub-sampling (motion blur)
// possible: the pipeline can evaluate the world at fractional frames.
export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ready: Promise<void>;
  /** Set every animated property for absolute time t (seconds). */
  update(t: number, aspect: number): void;
  /** Shutter samples wanted for the frame at time t (scene re-renders). */
  samplesAt(t: number): number;
  /** Writes the camera state for time t into `camera` (for velocity motion blur). */
  cameraAt(t: number, aspect: number, camera: THREE.PerspectiveCamera): void;
  /** Post-processing parameters for time t. */
  postAt(t: number): PostParams;
  dispose(): void;
}

export type WorldFactory = (renderer: THREE.WebGLRenderer) => World;

// 180 degree shutter: the exposure spans half a frame, centred on the frame time.
const SHUTTER = 0.5;

const FilmRenderer: React.FC<{factory: WorldFactory}> = ({factory}) => {
  const {gl} = useThree();
  const filmTime = useFilmTime();
  const {fps, width, height} = useVideoConfig();
  const frame = Math.round(filmTime * fps);
  const {delayRender, continueRender, cancelRender} = useDelayRender();
  const handle = useRef<number | null>(null);

  const world = useMemo(() => factory(gl), [factory, gl]);
  const shutter = useMemo(
    () => ({open: new THREE.PerspectiveCamera(), close: new THREE.PerspectiveCamera()}),
    [],
  );
  const pipeline = useMemo(() => {
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    return new FilmPipeline(gl, size.x, size.y);
  }, [gl]);

  useEffect(
    () => () => {
      world.dispose();
      pipeline.dispose();
    },
    [world, pipeline],
  );

  // Block the screenshot until this frame has been drawn by our own pipeline.
  // Layout effects run before @remotion/three's passive advance(), so the
  // handle is always registered in time.
  useLayoutEffect(() => {
    handle.current = delayRender(`Film frame ${frame} (t=${filmTime.toFixed(3)})`);
    return () => {
      if (handle.current !== null) {
        continueRender(handle.current);
        handle.current = null;
      }
    };
  }, [frame, filmTime, delayRender, continueRender]);

  useEffect(() => {
    let cancelled = false;
    world.ready
      .then(() => {
        if (cancelled) return;
        const size = gl.getDrawingBufferSize(new THREE.Vector2());
        pipeline.setSize(size.x, size.y);
        const t = filmTime;
        const samples = Math.max(1, Math.round(world.samplesAt(t)));
        const aspect = width / height;
        world.cameraAt(t - (SHUTTER * 0.5) / fps, aspect, shutter.open);
        world.cameraAt(t + (SHUTTER * 0.5) / fps, aspect, shutter.close);
        pipeline.render(
          world.scene,
          world.camera,
          samples,
          (i, n) => {
            // Centred shutter: sub-samples spread over [t - s/2, t + s/2).
            const offset = n === 1 ? 0 : ((i + 0.5) / n - 0.5) * SHUTTER;
            world.update(t + offset / fps, aspect);
          },
          // Grain/dither seed = frame index (film time in frames, via fps).
          {...world.postAt(t), seed: frame},
          samples === 1 ? shutter : undefined,
        );
        if (handle.current !== null) {
          continueRender(handle.current);
          handle.current = null;
        }
      })
      .catch((err) => cancelRender(err));
    return () => {
      cancelled = true;
    };
  }, [filmTime, frame, fps, width, height, gl, world, pipeline, shutter, continueRender, cancelRender]);

  return null;
};

export const FilmCanvas: React.FC<{factory: WorldFactory}> = ({factory}) => {
  const {width, height} = useVideoConfig();
  return (
    <ThreeCanvas
      width={width}
      height={height}
      gl={{
        antialias: false,
        alpha: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      }}
      flat
      linear
      style={{position: 'absolute', inset: 0}}
    >
      <FilmRenderer factory={factory} />
    </ThreeCanvas>
  );
};
