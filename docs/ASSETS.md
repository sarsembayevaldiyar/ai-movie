# ASSETS.md: источники и лицензии

Всё в видео сделано кодом. Внешние данные — только public domain или открытые лицензии. Сборка ассетов воспроизводима: `python3 tools/build_assets.py` (промежуточные файлы кладутся в `.asset-cache/`).

| Файл в проекте | Что это | Источник | Лицензия |
|---|---|---|---|
| `public/textures/earth_day_8k.jpg` | Альбедо Земли, 8192×4096, равнопромежуточная проекция | NASA **Blue Marble** (Shaded Relief + Bathymetry), тайлы EPSG:3857 z7 из npm-пакета `@freetiler/nasa-bluemarble@1.0.17`, перепроецированы в `tools/build_assets.py` | NASA open data / public domain (атрибуция: «NASA Earth Observatory») |
| `public/textures/earth_lw_8k.png` | R — огни городов, G — маска воды | Огни: NASA **Black Marble** (`@freetiler/nasa-blackmarble@1.0.14`), выделены из композита. Вода: Natural Earth 1:10m land + lakes | NASA: public domain; Natural Earth: public domain |
| `public/textures/kz_day.jpg`, `kz_lw.png` | Региональный патч Казахстана (45–90° в. д., 39–57° с. ш.), 182 px/° | Те же наборы NASA, тайлы z8 с GitHub-зеркал `freetiler/nasa-bluemarble`, `freetiler/nasa-blackmarble` | NASA public domain |
| `public/textures/earth_clouds_4k.png` | Облачный покров | **Процедурный** (numpy, seed 1771), климатология по широтам | собственная генерация |
| `public/textures/nebula_2k.png` | Туманность фона | **Процедурная** (numpy, seed 90210), цвета бренда `#4b3a8a` / `#1833da` / `#3e215b` | собственная генерация |
| `src/data/kazakhstan.json` | Граница Казахстана | Natural Earth 1:10m Admin 0 Countries (`ADM0_A3 = KAZ`), github.com/nvkelso/natural-earth-vector | public domain |
| `src/data/places.json` | Координаты городов (20 региональных хабов, 4 международных) | Natural Earth 1:10m Populated Places Simple | public domain |
| Звёзды, звёздная пыль | Каталог 16 000 звёзд и 7 800 частиц пыли | **Процедурные** (seeded PRNG, `src/world/sky.ts`) | собственная генерация |
| `public/fonts/Inter-*.woff2` | Фирменный шрифт Inter (Regular / Medium / SemiBold) | npm `inter-ui@4.1.1` (rsms/inter) | SIL Open Font License 1.1 (`public/fonts/Inter-LICENSE.txt`) |
| `public/brand/logo_main_on_black.webp` | Логотип (инверсная основная версия) | Оригинальный файл, переданный заказчиком (`materials/brandbook/logos/4.webp`) | собственность Astana Hub |
| `public/audio/soundtrack.wav` | Саундтрек 48 кГц / 24 бит | **Синтезирован кодом**: `tools/make_soundtrack.py` (numpy/scipy), оригинальная гармония | собственная генерация |

## Замечания
- **Сетевые ограничения окружения:** сайты NASA (`visibleearth`, `neo`, `svs`), `naciscdn.org`, `unpkg`, `jsdelivr` закрыты политикой сети. Поэтому данные NASA получены через npm-пакеты и GitHub-зеркала тех же тайлов (исходный слой — NASA GIBS).
- **Пало-Альто** в наборе Natural Earth отсутствует. Дуга ведёт в San Jose (≈25 км), подписи на экране нет (`docs/DECISIONS.md`).
- **Облака процедурные:** реальные облачные карты с открытой лицензией в доступных источниках не нашлись (live-cloud-maps содержит данные EUMETSAT с условиями атрибуции).
