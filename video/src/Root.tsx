import { Composition } from 'remotion';
import { Demo } from './Demo.tsx';
import { Title } from './Title.tsx';
import { DURATION, FPS, HEIGHT, TITLE, WIDTH } from './timeline.ts';

export function Root() {
  return (
    <>
      <Composition id="Title" component={Title} durationInFrames={Math.round(TITLE.duration * FPS)} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="Demo" component={Demo} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
}
