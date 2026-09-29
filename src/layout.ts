// Shared screen layout at 1920x1080 (px, top-left origin): the finale column and
// the logo lockup. The DOM overlay places the lockup with these values and the
// WebGL lines read the logo clear space from here, so no line can enter it.

export const FINALE_X = 740; // finale column: mission text and logo lockup
export const LOGO_SRC_W = 2000; // logo_main_on_black.webp
export const LOGO_SRC_H = 421;
export const LOGO_W = 480;
export const LOGO_H = (LOGO_W * LOGO_SRC_H) / LOGO_SRC_W; // 101 px
export const LOGO_CENTER_Y = 470;

// Brandbook p. 11: clear space X = height of the "astana hub" wordmark on every
// side of the lockup (measured on the rendered 480 px logo: 48 px). The lockup
// ends at the right edge of the "Join the unicorn game" slogan (measured: 1802 px).
export const LOGO_CLEAR_X = 48;
const LOCKUP_RIGHT = 1802;
export const LOGO_CLEAR_RECT = {
  x0: FINALE_X - LOGO_CLEAR_X,
  y0: LOGO_CENTER_Y - LOGO_H / 2 - LOGO_CLEAR_X,
  x1: LOCKUP_RIGHT + LOGO_CLEAR_X,
  y1: LOGO_CENTER_Y + LOGO_H / 2 + LOGO_CLEAR_X,
};
