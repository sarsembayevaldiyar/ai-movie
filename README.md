# Astana Hub — «Вселенная»

Имиджевый ролик Astana Hub, сделанный полностью кодом: Remotion + TypeScript + React, three.js (свой HDR-конвейер поверх `@remotion/three`), процедурный саундтрек на numpy. Без стоковых и сгенерированных видео.

- **90 с, 1920×1080, 60 fps (CFR), 5400 кадров.** Рендер детерминированный: каждый кадр — чистая функция времени.
- Концепция и раскадровка — `docs/STORYBOARD.md`, решения — `docs/DECISIONS.md`, проверка качества — `docs/QA.md`.
- Бренд (`docs/BRAND.md`) и факты (`docs/CONTENT.md`) взяты только из `materials/`. Источники данных и лицензии — `docs/ASSETS.md`.

## Результат
| Файл | Что это |
|---|---|
| `out/astanahub_universe_1080p60.mp4` | Финальная версия (119 МБ): H.264 High 4.2, CRF 14, `veryslow`, yuv420p, BT.709, AAC 320 кбит/с, 48 кГц, −14,4 LUFS, faststart |
| `out/render_1080p60/astanahub_universe_1080p60_master_prores.mov` | Мастер (4,6 ГБ): ProRes 422 HQ + PCM 24 бит / 48 кГц |
| `public/audio/soundtrack.wav` | Саундтрек отдельно: 48 кГц / 24 бит, −14 LUFS, true peak ≤ −1 dBTP |

Папка `out/` не хранится в git. Видео пересобирается командами ниже.

## Запуск
Нужны Node.js 22+, Python 3.11+ и Chromium (Remotion скачивает его сам, если сеть позволяет).

```bash
npm ci
python3 -m pip install -r tools/requirements.txt   # только для ассетов, звука и QA

npm run studio          # превью в Remotion Studio
npm run render:1080     # мастер ProRes 422 HQ + H.264 1080p60 (чанки по 10 с, возобновляемо)
npm run render:4k       # то же в 3840×2160 + 1080p даунскейлом из 4K (нужна мощная машина)
```

Вспомогательное:
```bash
npm run assets          # пересобрать текстуры Земли и векторы (NASA / Natural Earth → public/, src/data/)
npm run soundtrack      # пересобрать саундтрек под текущий таймлайн (src/timeline.ts)
npm run camera-report   # диагностика траектории камеры (скорость, ускорение, кадрирование)
npm run qa:motion       # скачки и мерцание по готовому mp4
npm run qa:stills       # контрольные кадры по сценам → docs/qa/
npm run typecheck
```

`remotion.config.ts` сам выбирает окружение. В облачном контейнере без GPU он берёт предустановленный headless shell и WebGL через SwiftShader (`swangle`). На обычной машине он использует Chrome, который скачивает Remotion, и GPU (`angle`). Переопределить можно переменными `REMOTION_BROWSER` и `REMOTION_GL`.

Если среда перезапускает долгие процессы, рендер и кодирование можно разбить на части. Каждая часть возобновляется с места остановки:
- `tools/render_parts.sh <первый_кадр>` рендерит 10-секундный чанк кусками по 2,5 с;
- `tools/encode_parts.sh` кодирует H.264 по чанкам, склеивает их без перекодирования, добавляет звук и собирает мастер.

## Структура
```
src/
  Root.tsx, Film.tsx        композиции Film (90 с) и Preview (кадры по списку времён)
  timeline.ts               все тайминги в секундах, easing
  brand.ts                  единственное место с цветами бренда (из docs/BRAND.md)
  gl/                       HDR-конвейер: velocity motion blur, bloom, ACES, дизеринг
  world/                    Земля, атмосфера, облака, Солнце, звёзды, сеть, орбиты, камера
  overlay/                  фирменная типографика, градиенты, логотип, зерно (DOM)
tools/                      ассеты, саундтрек, рендер, QA
docs/                       бренд, контент, раскадровка, решения, ассеты, QA
materials/                  исходные материалы заказчика (брендбук, презентации)
```
