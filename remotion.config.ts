import {Config} from '@remotion/cli/config';

// Headless Chrome shipped with the container (remotion.media is blocked, so Remotion
// cannot download its own browser). No GPU: WebGL runs on SwiftShader via ANGLE.
Config.setBrowserExecutable(
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
);
Config.setChromiumOpenGlRenderer('swangle');
Config.setVideoImageFormat('png');
Config.setConcurrency(1);
Config.setDelayRenderTimeoutInMilliseconds(600000);
Config.setOverwriteOutput(true);
