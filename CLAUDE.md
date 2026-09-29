# ai-movie: Astana Hub image video (code-only, 60 fps)

A premium image video for Astana Hub, built entirely from code: Remotion + TypeScript + React,
@remotion/three / three.js for 3D, a procedural soundtrack, 60 fps, deterministic render.
No stock footage, no generative video, no ready-made footage.

## Materials
- `materials/brandbook/`: the brandbook (`ah_brandbook_2024.pdf`, 55 pages) and logo renders (`logos/*.webp`).
  The brandbook is law: any decision that contradicts it is forbidden.
- `materials/presentations/`: presentations (RU / EN / general). They have no text layer (images only), so read them page by page.
  These are the only source of facts and numbers: no number in the materials means no number in the video.
- `materials/references/`: video references (still empty at the moment).

## Project rules
- Language on screen: Russian unless agreed otherwise. Code and comments: English.
- All durations in seconds, converted to frames via `fps` from `useVideoConfig()`. No hardcoded frame counts.
- Animation only via `useCurrentFrame()` / `interpolate()` / `spring()`. No unseeded `Math.random()`,
  no CSS animations, no `setTimeout` / `requestAnimationFrame`, no dependence on real time.
- Brand colors live only in `src/brand.ts`, taken from `docs/BRAND.md`.
- Art-director decisions go into `docs/DECISIONS.md`.

## Skills
Project skills live in `.claude/skills/` (installed via the `skills` CLI; the list is in `skills-lock.json`).

| Skill | Source | When to use |
|---|---|---|
| `find-skills` | `vercel-labs/skills` | Before any new complex task: search for specialized skills (`npx skills find <query>`, `npx skills add <owner/repo> --list`). |
| `remotion-best-practices` | `remotion-dev/skills` | Any Remotion code: router to markup (3D, motion blur, effects, fonts, timing, audio, ffmpeg), render and other sub-guides. |
| `r3f-fundamentals`, `r3f-shaders`, `r3f-postprocessing`, `r3f-textures`, `r3f-materials` | `EnzeD/r3f-skills` | R3F scene setup, GLSL materials and uniforms, post chain order (bloom → tonemap), texture color spaces. |
| `threejs-atmosphere-aerial-perspective` | `scottstts/Threejs-Awesome-Graphics-Agent-Skills` | Earth atmosphere: limb glow, sun transmittance, Rayleigh/Mie. |
| `threejs-camera-direction` | `scottstts/Threejs-Awesome-Graphics-Agent-Skills` | Authored cinematic camera, planet-scale framing, near/far per shot, handoffs. |
| `threejs-procedural-fields` | `scottstts/Threejs-Awesome-Graphics-Agent-Skills` | Cloud/ocean/city-light masks, nebula noise fields. |
| `threejs-scene-composition` | `calesthio/generative-media-skills` | Deterministic frame rendering of Three.js for video, render QA. |
| `shader-dev` | `MiniMax-AI/skills` | GLSL technique library: noise, starfields, scattering, grain, AA. |
| `motion-art-direction`, `kinetic-typography` | `iart-ai/*` | Motion language spec, typography reveals and stagger. |
| `ffmpeg-ops` | `0xdarkmatter/claude-mods` | Encoding, concat, loudness (-14 LUFS), CFR/VFR probing. |
| `verification-before-completion`, `systematic-debugging` | `obra/superpowers` | Evidence before "done"; root-cause debugging. |

Project overrides for these skills (they win over the skill text):
- Rendering from the CLI is explicitly requested by the user (final deliverables). Remotion Studio is not used (no browser here).
- The Kazakhstan border and the globe are drawn in three.js shaders, not with Remotion Maps / Mapbox.
- Headless Chrome: use the preinstalled `/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell`
  (`remotion.media` is blocked, so Remotion cannot download its own browser). No GPU: WebGL runs on SwiftShader (`--gl=swangle`).
- Docs hosts `remotion.dev` and `threejs.org` are blocked; read sources/docs via `raw.githubusercontent.com` or `node_modules`.
- Time in shaders always comes from the Remotion frame (`frame / fps`), never from `useFrame` delta or the clock.

Rules for using skills:
- Read the `SKILL.md` of a skill before working in its domain and follow it.
- Install new skills only with the user's permission: `npx skills add <owner/repo> --skill <name> -a claude-code -y`
  (project-level, then record it in the table above).
- The `skills.sh` registry may be blocked by the environment's network policy. In that case `npx skills find` returns nothing:
  search via web search and check repositories with `npx skills add <owner/repo> --list` (GitHub is reachable).

## Standing rule: skills first
When the user gives you a new complex task, first use find-skills to check whether specialized skills exist
that could improve how it gets done. If you find a suitable one, suggest installing it and explain the benefits. Do not install without permission.
