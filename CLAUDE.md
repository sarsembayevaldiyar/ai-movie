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

Rules for using skills:
- Read the `SKILL.md` of a skill before working in its domain and follow it.
- Install new skills only with the user's permission: `npx skills add <owner/repo> --skill <name> -a claude-code -y`
  (project-level, then record it in the table above).
- The `skills.sh` registry may be blocked by the environment's network policy. In that case `npx skills find` returns nothing:
  search via web search and check repositories with `npx skills add <owner/repo> --list` (GitHub is reachable).

## Standing rule: skills first
When the user gives you a new complex task, first use find-skills to check whether specialized skills exist
that could improve how it gets done. If you find a suitable one, suggest installing it and explain the benefits. Do not install without permission.
