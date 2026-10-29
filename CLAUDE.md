# Разбор партий

Полное ТЗ: [SPEC.md](./SPEC.md). Работать по этапам из раздела 4, после каждого этапа собирать, проверять критерии и коммитить.

- Комментарии в коде не писать.
- Все тексты интерфейса на русском, общие строки в `src/renderer/i18n/ru.ts`.
- Чистая логика анализа (PGN, классификация, точность, комментарии, итог) — `src/renderer/analysis`, дебюты — `src/renderer/openings`. Main-процесс импортирует эти модули напрямую, поэтому в них нельзя использовать DOM и Electron.
- Тесты: `npm test`. Эталон Приложения B лежит в `tests/fixtures/appendix-b-analysis.json` (Stockfish, глубина 20); пересчитать — `npm run analyze:fixture`.
- Гайды дебютов — `resources/openings/guides.json`, перед релизом обязательно `npm run verify:guides` (Stockfish, глубина ≥ 20).
- Stockfish 17.1 лежит в `resources/engines/<платформа>` и попадает в сборку; путь можно переопределить переменной `STOCKFISH_PATH`.
- Задачи: `resources/puzzles` (выборка lichess, CC0, и композиции). Композиции пересобираются `npm run build:compositions`.
- Курс дебютов: `src/renderer/course/course.json`, после правок — `npm run verify:course`.
- Сборки: `npm run dist:mac` (на Mac), `npm run dist:win` (на Windows); выпуск по тегу `v*` через GitHub Actions.
