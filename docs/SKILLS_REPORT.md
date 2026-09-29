# Отчёт по skills (Шаг 0)

Дата: 2026-09-29. Проект: Remotion + TypeScript + @remotion/three / three.js, 60 fps, детерминированный рендер, контейнер без GPU (4 ядра).

## Как искали
- `find-skills` (vercel-labs/skills) установлен в `.claude/skills/find-skills/`. Claude Code его распознаёт: skill лежит в стандартной папке проекта.
- **Ограничение окружения:** хост `skills.sh` (реестр, через который работает `npx skills find`) закрыт сетевой политикой (ответ 403). Поэтому поиск сделан в обход: веб-поиск + проверка каждого репозитория через `npx skills add <owner/repo> --list` и чтение самих `SKILL.md` с GitHub.
- Работали 25 агентов: 12 искали по категориям, 12 перепроверяли найденное, 1 искал пропуски. Всего 266 записей-кандидатов. Каждый кандидат из таблиц ниже реально существует: skill перечислен через `--list`, его `SKILL.md` прочитан, скрипты проверены на опасное поведение. Ничего, кроме `find-skills`, **не установлено**.
- Популярность — только то, что видели на страницах GitHub. Число установок со skills.sh проверить нельзя.

Формат установки (на уровне проекта, только для Claude Code):
`npx skills add <owner/repo> --skill <имя> [<имя> ...] -a claude-code -y`

## Итоговая рекомендация

### A. Приоритетные: ставить

| # | Skill | Репозиторий | Назначение и возможности | Совместимость (Remotion + Three.js, 60 fps) | Рекомендация |
|---|---|---|---|---|---|
| 1 | `remotion-best-practices` | [remotion-dev/skills](https://github.com/remotion-dev/skills) (официальный, 4.8k★) | Роутер всех официальных Remotion-skills (markup, render, 3d, motion-blur, effects, transitions, local-fonts, timing, audio, ffmpeg). Правила ThreeCanvas: запрет `useFrame`, всё от `useCurrentFrame()`. `@remotion/motion-blur`, 58 пресетов `@remotion/effects`, встроенный `npx remotion ffmpeg`. | Максимальная. Версия 4.0.530, свежая. Поправки для нас: рендер headless, а не Studio; граница Казахстана делается в three.js, а не в Remotion Maps; GL-режим `angle`, запасной `swangle`. | **Ставить (приоритет)**. Отдельно `remotion-markup` и `remotion-render` не нужны: они уже внутри. |
| 2 | `r3f-shaders`, `r3f-postprocessing`, `r3f-fundamentals`, `r3f-textures`, `r3f-materials` | [EnzeD/r3f-skills](https://github.com/EnzeD/r3f-skills) (MIT, 121★) | Актуальные правила под Fiber 9 / postprocessing 6.39. ShaderMaterial и uniforms, пространства координат для fresnel/rim, linear↔sRGB, порядок Bloom → ToneMapping(ACES), свои Effect'ы, цветовые пространства текстур. | Высокая: @remotion/three — это и есть R3F. Время в uniforms передаём от кадра, а не `useFrame` delta. | **Ставить (приоритет)**. Только markdown, без скриптов. |
| 3 | `threejs-atmosphere-aerial-perspective` | [scottstts/Threejs-Awesome-Graphics-Agent-Skills](https://github.com/scottstts/Threejs-Awesome-Graphics-Agent-Skills) (862★) | Планетная атмосфера как единая система: Rayleigh/Mie/озон, лимб, пропускание Солнца, LUT'ы для вида из космоса к поверхности. | Высокая. LUT дешевле raymarching при программном GL в 4K. Импорт `?raw` придётся адаптировать под бандлер Remotion. | **Ставить (приоритет)**. Атмосфера — самый заметный элемент кадров с Землёй. Весит около 13 МБ (LUT'ы). |
| 4 | `threejs-camera-direction` | тот же scottstts | Камера как авторская кинематографическая система: планетный up-вектор, near/far для каждого шота, звёзды привязаны к камере, передачи lerp/slerp между шотами. | Хорошая. Stateful-сглаживатели заменяем на замкнутые функции от кадра. | **Ставить**. Камера — основа этого видео. |
| 5 | `threejs-scene-composition` | [calesthio/generative-media-skills](https://github.com/calesthio/generative-media-skills) (MIT, 186★) | Правила именно для рендера видео в Three.js: время = frame/fps, всё состояние из абсолютного времени, seed для всех шумов, двойной рендер стресс-кадров и сравнение, порядок post-эффектов, цвет. | Высокая: это прямое описание детерминизма Remotion. | **Ставить**. |
| 6 | `ffmpeg-ops` | [0xdarkmatter/claude-mods](https://github.com/0xdarkmatter/claude-mods) (MIT, 43★) | Скрипты `probe-media --doctor` (VFR/CFR, pix_fmt), двухпроходный loudnorm до −14 LUFS, правила concat, проверка детерминизма через framemd5, H.264/H.265. | Хорошая. Системного ffmpeg нет: нужен shim на `npx remotion ffmpeg`. ProRes-мастер делаем самим Remotion. | **Ставить**. Мало звёзд, но содержимое перепроверено, скрипты безопасные (stdlib, без сети). |
| 7 | `verification-before-completion`, `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) (293k★) | Не объявлять «готово» без доказательств: still-кадры, ffprobe, хэш кадров. Поиск первопричины для сбоев WebGL в headless Chrome. | Не зависит от стека. | **Ставить**. Только markdown. |

### B. Полезные: ставить по желанию (я бы поставил 8–10)

| # | Skill | Репозиторий | Назначение | Совместимость | Рекомендация |
|---|---|---|---|---|---|
| 8 | `shader-dev` | [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills) (MIT, 13.7k★) | Библиотека GLSL-техник: шумы/FBM/domain warp, звёздные поля и галактики, объёмные облака, Rayleigh/Mie, порядок post, зерно, AA. | Хорошая как справочник. Код в стиле ShaderToy, его придётся портировать. | **Ставить**: для звёзд, туманности и зерна. |
| 9 | `threejs-procedural-fields` | scottstts | Методика процедурных полей: маски облаков, океана и огней, терминатор, domain warp туманности. Отладочный вид для каждого поля. | Высокая, чистый GLSL. | **Ставить**. |
| 10 | `motion-art-direction`, `kinetic-typography` | [iart-ai/motion-design-skills](https://github.com/iart-ai/motion-design-skills), [iart-ai/kinetic-typography-skills](https://github.com/iart-ai/kinetic-typography-skills) (MIT, 38★ / 12★) | Спецификация «языка движения» до анимации: easing, тайминги, одна кульминация, сдержанность. Таксономия reveal'ов, stagger, есть рецепт для Remotion. | Частичная: CSS/GSAP-примеры не использовать, тайминги растянуть под кино. | **Ставить** для сцены 5 (кинетическая типографика). |
| 11 | `build-sfx` | [lens-studio-devs/ls-extensions](https://github.com/lens-studio-devs/ls-extensions) (Apache-2.0) | Офлайн-движок процедурного SFX на Node: whoosh, riser, impact, sparkle, гранулярные подложки, реверб. | Хорошая, если явно задавать `seed` (иначе Math.random). Выход 44.1 kHz, передискретизация до 48 kHz. Привязан к путям Lens Studio. | **По желанию**. Звук можно сделать и своим numpy-синтезом. |
| 12 | `writing-plans` | obra/superpowers | План с «Global Constraints» (60 fps, детерминизм, ProRes и т.д.) и проверками на каждый шаг. | Любой стек. | **По желанию**. |
| 13 | `source-driven-development` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (99.9k★) | Сверять API с официальной документацией нужной версии. | Полезно, но remotion.dev и threejs.org закрыты сетью; документация доступна через raw.githubusercontent.com. | **По желанию**. |
| 14 | `threejs-procedural-geometry` | scottstts | Процедурное моделирование кодом (loft/sweep/bevel) + аудит топологии. | Геометрия переносится; примеры на WebGPU/TSL — нет. | **Только если** будет 3D-объект (например, стилизованное здание или Байтерек). |
| 15 | `cinetic` | [Leonxlnx/cinetic](https://github.com/Leonxlnx/cinetic) (4★, репозиторию 1 день) | Remotion-фильм 60 fps с детерминированным синтезированным звуком, accumulation motion blur, финишинг BT.709, WebGL в headless. | Очень близко по теме. Но его «жёсткие запреты» (bloom, частицы, lens flare) противоречат нашей концепции. | **Пока не ставить**: слишком новый. Могу взять идеи (accumulate.py) без установки. |
| — | `planning-with-files` | [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) (27k★) | Память проекта в файлах между сессиями. | Регистрирует 5 хуков на каждый вызов инструментов. | **Не ставить сейчас**: нам хватит `docs/` + git. |

### C. Не ставить (главное из 199 отклонённых)

| Направление | Что нашли | Почему нет |
|---|---|---|
| Blender / 3D-моделирование | blender-mcp, cli-anything-blender, Flue Blender, blender-scripting и др. | Blender не установлен и не нужен: всё делаем кодом. Многие требуют GUI или MCP-сервер, у одного лицензия NonCommercial. |
| DaVinci Resolve / монтаж | [samuelgursky/davinci-resolve-mcp](https://github.com/samuelgursky/davinci-resolve-mcp) (лучший, 3.2k★), video-use, buttercut, FCPXML | Нужен запущенный Resolve или другой NLE, а также живые футажи. У нас монтаж — это таймлайн Remotion + ffmpeg concat. |
| Другие Remotion-skills | wshuyi/remotion-video, форки в everything-claude-code, vercel-labs/json-render `remotion-best-practices` | Устаревшие копии официального skill. У json-render совпадает имя с официальным — будет конфликт. |
| Three.js-паки | cloudai-x/threejs-skills (3.4k★), claudekit, OpenAEC, emalorenzo | Устаревший post-processing (старая сигнатура FilmPass), анимация через Math.random и delta. Всё это уже перекрыто r3f-skills. |
| WebGPU/TSL | dgreenheck/webgpu-threejs-tsl | Качественный, но под WebGPU, а мы рендерим через WebGL в headless Chrome. |
| Физика | r3f-physics, threejs-impl-physics | Rigid-body симуляция в сценарии не нужна. |
| PDF | anthropics/skills `pdf` | Уже есть встроенный `anthropic-skills:pdf`. |

## Что важно для следующих шагов (выяснилось при проверке)
1. **Сеть:** закрыты `skills.sh`, `remotion.dev`, `threejs.org` и `remotion.media`. С последнего Remotion по умолчанию скачивает Chrome Headless Shell. Обход: в контейнере уже есть Chromium (`/opt/pw-browsers/chromium_headless_shell-1194`), рендер через `--browser-executable`. Документацию читаем через `raw.githubusercontent.com` (доступен).
2. **ffmpeg** в системе нет, но Remotion несёт свой (`npx remotion ffmpeg` / `ffprobe`, с prores_ks и libx264).
3. **GPU нет:** WebGL идёт программно (ANGLE/SwiftShader). Рендер 4K60 будет медленным: планируем рендер по сценам с `--concurrency`.
