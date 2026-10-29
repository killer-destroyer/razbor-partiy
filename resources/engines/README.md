# Stockfish

В этой папке лежат официальные сборки Stockfish 17.1 (https://github.com/official-stockfish/Stockfish/releases/tag/sf_17.1):

- `darwin-arm64/stockfish` — macOS, Apple Silicon (`stockfish-macos-m1-apple-silicon`);
- `win32-x64/stockfish-avx2.exe` — Windows, процессоры с AVX2 (примерно с 2013 года);
- `win32-x64/stockfish-sse41.exe` — Windows, запасной вариант для более старых процессоров.

Программа сама выбирает подходящий файл. Stockfish распространяется по лицензии GNU GPL v3 (`COPYING-stockfish.txt`),
авторы — в `AUTHORS-stockfish.txt`, исходный код — по ссылке выше.

Stockfish 18 не используется, потому что его файлы больше 100 МБ, а GitHub не принимает такие файлы без Git LFS.
