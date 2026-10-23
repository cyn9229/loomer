import { Composition } from 'remotion';
import { Demo } from './Demo.tsx';
import { DURATION, FPS, HEIGHT, WIDTH } from './timeline.ts';

export function Root() {
  return <Composition id="Demo" component={Demo} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={WIDTH} height={HEIGHT} />;
}
