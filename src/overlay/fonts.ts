import {loadFont} from '@remotion/fonts';
import {staticFile} from 'remotion';
import {FONT_FAMILY, WEIGHTS} from '../brand';

// Brand typeface (brandbook p. 21-22): Inter Regular / Medium / SemiBold, loaded
// locally before the first frame renders (loadFont blocks rendering until ready).
export const fontsReady = Promise.all([
  loadFont({family: FONT_FAMILY, url: staticFile('fonts/Inter-Regular.woff2'), weight: String(WEIGHTS.regular)}),
  loadFont({family: FONT_FAMILY, url: staticFile('fonts/Inter-Medium.woff2'), weight: String(WEIGHTS.medium)}),
  loadFont({family: FONT_FAMILY, url: staticFile('fonts/Inter-SemiBold.woff2'), weight: String(WEIGHTS.semibold)}),
]);
