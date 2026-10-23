import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender } from 'remotion';
import { Callouts } from './components/Callouts.tsx';
import { Camera } from './components/Camera.tsx';
import { Captions } from './components/Captions.tsx';
import { NameTitle } from './components/NameTitle.tsx';
import { PrivacyList } from './components/PrivacyList.tsx';
import { Screen } from './components/Screen.tsx';
import { Slides } from './components/Slides.tsx';

/**
 * The whole demo video, picture only (the audio comes from rough-cut v2).
 * Layers, bottom to top: the screen recording, its callouts, slides, the
 * privacy list, captions, the camera, and the opening name title.
 */
export function Demo() {
  useFonts();
  return (
    <AbsoluteFill style={{ background: '#0d0c11' }}>
      <Screen />
      <Callouts />
      <Slides />
      <PrivacyList />
      <Captions />
      <Camera />
      <NameTitle />
    </AbsoluteFill>
  );
}

/** Holds rendering until Inter's weights are loaded, so no frame falls back to a system font. */
function useFonts() {
  const [handle] = useState(() => delayRender('Loading Inter'));
  useEffect(() => {
    Promise.all(['400', '500', '600'].map((w) => document.fonts.load(`${w} 40px Inter`))).then(() => continueRender(handle));
  }, [handle]);
}
