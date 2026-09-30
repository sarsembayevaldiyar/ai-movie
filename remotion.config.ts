/// <reference types="node" />
import fs from 'node:fs';
import {Config} from '@remotion/cli/config';

// Browser and WebGL backend. In the cloud container (no GPU, remotion.media blocked)
// the preinstalled headless shell renders WebGL on SwiftShader ('swangle'). Elsewhere
// Remotion's own Chrome and the GPU ('angle') are used. Override with the
// REMOTION_BROWSER / REMOTION_GL environment variables.
const CONTAINER_SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = process.env.REMOTION_BROWSER ?? (fs.existsSync(CONTAINER_SHELL) ? CONTAINER_SHELL : null);
if (browser) Config.setBrowserExecutable(browser);
type GlRenderer = Parameters<typeof Config.setChromiumOpenGlRenderer>[0];
Config.setChromiumOpenGlRenderer(
  (process.env.REMOTION_GL as GlRenderer | undefined) ?? (browser === CONTAINER_SHELL ? 'swangle' : 'angle'),
);
Config.setVideoImageFormat('png');
Config.setConcurrency(1);
Config.setDelayRenderTimeoutInMilliseconds(600000);
Config.setOverwriteOutput(true);
