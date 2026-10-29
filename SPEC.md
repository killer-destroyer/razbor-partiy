# «Разбор партий» — ТЗ для Claude Code

Ты (Claude Code) строишь десктопное приложение для macOS (Apple Silicon, MacBook) для разбора шахматных партий с chess.com. Ниже всё, что нужно: цель, стек, архитектура, этапы с критериями готовности, формулы, настройки и рабочий прототип в Приложении A, от которого надо отталкиваться.

## 0. Как работать с этим файлом

- Положи этот файл в пустую папку проекта как `SPEC.md` и создай рядом `CLAUDE.md` со ссылкой на него.
- Иди строго по этапам из раздела 4. После каждого этапа: собери, запусти, проверь критерии готовности, закоммить в git.
- Не спрашивай подтверждения на очевидные шаги: если следующий шаг понятен из ТЗ, делай его. Спрашивай только там, где ТЗ правда оставляет выбор.
- **Не пиши комментарии в коде.** Совсем. Код должен читаться за счёт имён.
- Интерфейс и все тексты в приложении на русском.
- Логику из Приложения A (разбор PGN с русской нотацией, классификация ходов, объяснения ошибок) переноси, а не переписывай с нуля: она проверена на реальной партии.

## 1. Что это за программа

Пользователь играет на chess.com (ник **Arsenkryt**), язык интерфейса русский. Он хочет:

1. Загружать свои партии с chess.com (по нику, без копирования PGN) или вставлять PGN/FEN вручную.
2. Получать подробный разбор: оценка каждого хода, классы ходов как на chess.com, точность в процентах, примерный рейтинг игры, текстовые комментарии движка, объяснение каждой ошибки (что было лучше и чем соперник мог наказать).
3. Видеть, какой дебют сыгран (по полной базе дебютов со всеми вариантами), и изучать дебюты в отдельном обозревателе: как играется каждый, плюсы и минусы, ловушки, нюансы.
4. Доску и фигуры как у него на chess.com по умолчанию, с возможностью менять в настройках. Плавные анимации, высокий FPS, много настроек как на chess.com.

## 2. Стек

| Что | Чем | Почему |
|---|---|---|
| Оболочка | **Electron** (последняя стабильная) + **electron-vite** | настоящее .app, доступ к нативному движку и сети без CORS |
| UI | **React + TypeScript**, состояние в **Zustand** | |
| Доска | **chessground** (lichess-org/chessground) | плавные анимации, drag&drop, стрелки ПКМ, подсветки, координаты, темы — ровно поведение как на chess.com. Лицензия GPL-3.0: для личного использования ок, указать в «О программе» |
| Правила | **chess.js 1.x** (BSD-2) | SAN/FEN/легальные ходы. В 1.x нет опции `sloppy`, используй `move(san, { strict: false })` |
| Движок | **Stockfish** нативный бинарник (последний релиз с github.com/official-stockfish/Stockfish/releases, ассет `stockfish-macos-m1-apple-silicon`) | многопоточный, NNUE внутри, в разы сильнее WASM |
| Графики | Canvas 2D (свой код) | быстро, 60+ FPS |
| Хранилище | **better-sqlite3** в `app.getPath('userData')` | кэш анализов, импортированные партии, тренажёр |
| Тесты | **vitest** | |
| Сборка | **electron-builder**, цель `dmg` + `zip`, arch `arm64` | |

## 3. Архитектура

```
src/
  main/            процесс Electron
    index.ts       окно, меню, IPC
    engine.ts      пул UCI-движков (child_process), очередь задач
    chesscom.ts    клиент chess.com Published-Data API + автоотслеживание
    db.ts          sqlite
    notify.ts      системные уведомления macOS
  preload/index.ts contextBridge: window.api = { engine, chesscom, db, settings }
  renderer/
    app/           роутинг экранов
    screens/       Review, Import, Openings, Trainer, Stats, Settings, FreeAnalysis
    board/         обёртка над chessground, темы, наборы фигур, звуки
    analysis/      wp, accuracy, classify, commentary, rating estimate
    openings/      загрузка базы, определение дебюта, гайды
    i18n/ru.ts     все строки
resources/
  bin/stockfish
  openings/*.tsv   база дебютов
  openings/guides.json
  pieces/<set>/*.svg
```

Требования:
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. В preload только `contextBridge` и `ipcRenderer`.
- CSP в index.html: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'`. Шрифты положить локально (IBM Plex Sans, IBM Plex Mono, OFL).
- Сеть только из main-процесса и только на белый список хостов: `api.chess.com` (и опционально `api.anthropic.com`, см. 11.4).

## 4. Этапы

Каждый этап заканчивается рабочим запуском `npm run dev` и проверкой критериев.

### M0. Каркас
- electron-vite + React + TS, окно 1400×900, тёмная тема по умолчанию, меню macOS на русском.
- Критерий: приложение запускается, есть пустые экраны и навигация слева.

### M1. Перенос прототипа
- Перенести из Приложения A: разбор PGN (английская и русская нотация: Кр→K, К→N, Ф→Q, Л→R, С→B, кириллическая «х» → x, 0-0 → O-O, вырезание комментариев `{}`, вариантов `()`, NAG `$n`, номеров ходов, результата), классификацию, объяснения, график оценки, список ходов, карточки игроков, «Ваши ошибки», «Ошибки соперника».
- Движок: `engine.ts` запускает `resources/bin/stockfish` (в dev: `bin/stockfish` или `which stockfish` после `brew install stockfish`), шлёт `uci`, ставит `Threads = cpu-1`, `Hash = 256`, `MultiPV`.
- Критерий: тестовая партия из Приложения B даёт близкие к эталону классы (±1 класс допустимо из-за глубины).

### M2. Доска как на chess.com
Раздел 5 целиком. Критерий: по умолчанию доска выглядит как у пользователя, все настройки из 5.3 работают и сохраняются между запусками.

### M3. Импорт с chess.com
Раздел 7. Критерий: ввод ника `Arsenkryt` показывает последние партии, клик запускает разбор, автоотслеживание ловит новую завершённую партию и шлёт уведомление.

### M4. База дебютов и определение дебюта
Раздел 8.1–8.2. Критерий: в разборе показано «Славянская защита: …» с ECO и ходом, на котором партия вышла из теории.

### M5. Обозреватель дебютов
Раздел 8.3–8.5.

### M6. Комментарии движка, точность, рейтинг игры
Раздел 6 и 9.

### M7. Доп. фичи
Раздел 11.

### M8. Упаковка
Раздел 13.

## 5. Доска

### 5.1. Внешний вид по умолчанию (как у пользователя на chess.com)
- **Доска «Серая»:** светлые поля `#D8D9D8`, тёмные `#A8A9A8` (сняты пипеткой со скриншота его настроек).
- **Фигуры:** плоские чёрно-белые с контуром (у него выбран набор такого стиля). Не копируй ассеты chess.com: это их собственность. Возьми максимально похожий открытый набор из репозитория lichess-org/lila (`public/piece/`, например `cburnett` или `alpha`), проверь лицензию в `COPYING.md` и укажи авторство в «О программе».
- **Координаты: снаружи доски.**
- **Подсветка последнего хода: включена.**

### 5.2. Другие темы
Минимум 10 досок: Серая, Зелёная (классика), Коричневая, Синяя, Ледяная, Мрамор, Дерево (текстура, сгенерировать процедурно на canvas, без чужих картинок), Фиолетовая, Тёмная, Красная. Минимум 8 наборов фигур из lila с подходящими лицензиями. В настройках сетка превью, как на chess.com: клик выбирает, справа живое превью 3×3, кнопки «Сохранить» и «Отмена».

### 5.3. Настройки (экран «Настройки», вкладки как на chess.com)
**Доска и фигуры:** тема доски, набор фигур, координаты (нет / внутри / снаружи), подсветка последнего хода, показывать легальные ходы (точки), показывать угрозы (поля под боем), размер доски.
**Игровой процесс и анимация:** тип анимации (нет / медленно 300 мс / обычно 200 мс / быстро 120 мс), перемещение фигур (перетаскивание / клик / оба), авто-превращение в ферзя, стрелки и выделения правой кнопкой мыши (обычная ПКМ, с Shift, с Alt, с Ctrl — разные цвета, как на chess.com), показывать стрелку лучшего хода, показывать шкалу оценки.
**Звук:** вкл/выкл, громкость, звуки хода, взятия, шаха, рокировки, превращения, конца партии. Звуки синтезировать через WebAudio (свои, без чужих файлов).
**Анализ:** глубина или время на позицию, MultiPV 1–5, потоки, хэш, профиль классификации («как chess.com» по умолчанию / «строгий как lichess»), автоанализ при импорте.
**Интерфейс:** тема (системная / светлая / тёмная), нотация (русская / английская / иконки фигур), ник chess.com.

### 5.4. Плавность (FPS)
- Анимации только через `transform`/`opacity`, `requestAnimationFrame`. chessground это уже делает, не ломай.
- Строки `info` от движка приходят десятками в секунду: в React отдавай не чаще 10 раз в секунду (throttle), в рендерер слать только итог глубины.
- График оценки и шкала на canvas, перерисовка только при изменении.
- Список ходов виртуализировать при >200 полуходов.
- Цель: 60 FPS на MacBook при навигации стрелками и анимации; на дисплеях 120 Гц работать на их частоте (rAF это даёт сам).

## 6. Анализ: формулы

### 6.1. Шанс на победу (win%) из оценки
```
wp(cp) = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)     cp обрезать до ±1000
мат в пользу белых → 100, в пользу чёрных → 0
```
Оценка всегда хранится с точки зрения белых. UCI отдаёт оценку со стороны того, кто ходит: для хода чёрных умножай на −1.

### 6.2. Потеря хода
`loss = max(0, wp_до − wp_после)` для белых и наоборот для чёрных (в пунктах процента).

### 6.3. Классы ходов (профиль «как chess.com»)
| Класс | Значок | Условие |
|---|---|---|
| Книжный | 📖 | позиция после хода есть в базе дебютов (по EPD, с учётом транспозиций) и ход сделан до выхода из теории |
| Блестящий | !! | ход лучший или loss < 2, в варианте PV есть жертва (материал стороны после 3 полуходов PV меньше хотя бы на 2 пешки при сохранении оценки), позиция до хода не выиграна полностью (wp своей стороны < 97) |
| Отличная находка | ! | единственный хороший ход: лучший, а второй по MultiPV хуже на ≥10 пунктов wp; позиция до хода не выиграна полностью |
| Лучший | ★ | совпадает с первым ходом движка |
| Отличный | | loss < 2 |
| Хороший | | loss < 5 |
| Неточность | ?! | loss < 10 |
| Ошибка | ? | loss < 20 |
| Пропуск | ✕ | предыдущий ход соперника был ошибкой или зевком, а этот ход не воспользовался (loss ≥ 10 и после хода преимущество, данное соперником, пропало) |
| Зевок | ?? | loss ≥ 20 |

Профиль «строгий» (как в прототипе, Приложение A): неточность ≥7, ошибка ≥12, зевок ≥18. Пороги вынести в константы.

### 6.4. Точность (как lichess)
```
accuracy_move = clamp(103.1668 * exp(-0.04354 * loss) - 3.1669, 0, 100)
```
Точность партии: среднее из двух величин: (а) взвешенное среднее accuracy_move с весами = стандартное отклонение wp в скользящем окне (размер окна = clamp(кол-во ходов / 10, 2, 8)), (б) гармоническое среднее accuracy_move. Показывать точность отдельно по фазам: дебют (пока в книге или до 12-го хода), миттельшпиль, эндшпиль (≤ 6 фигур без пешек и королей на доске или ферзей нет и ≤ 10 фигур всего).

### 6.5. Примерный рейтинг игры
Кусочно-линейная интерполяция по точности (подписать «ориентировочно»):
`50→600, 60→900, 70→1200, 75→1400, 80→1600, 85→1850, 90→2100, 93→2300, 95→2500, 98→2800`.
Дополнительно учитывать долю зевков: −50 за каждый зевок сверх первого, но не ниже 400.

## 7. Импорт с chess.com

Публичный API без ключа (Published-Data API):
- `GET https://api.chess.com/pub/player/{ник}/games/archives` → `{ archives: [url, …] }` (по месяцам).
- `GET https://api.chess.com/pub/player/{ник}/games/{YYYY}/{MM}` → `{ games: [{ url, pgn, time_control, time_class, end_time, rated, rules, white: { username, rating, result }, black: {…}, accuracies? }] }`.
- Заголовок `User-Agent: RazborPartiy/1.0 (личное приложение)`. Запросы последовательно, при 429 ждать и повторять с паузой.
- Ник в URL в нижнем регистре.

Экран «Импорт»: поле ника (запоминается), список последних 50 партий (дата, контроль, соперник и рейтинг, цвет, результат, дебют из заголовка ECOUrl), фильтры (блиц/рапид/пуля/дейли, победы/поражения), кнопка «Разобрать», массовый «Разобрать все» в фоне.

**Автоотслеживание (вместо «вписывания вручную»):** переключатель «Следить за новыми партиями». Main-процесс раз в 60 с проверяет архив текущего месяца; когда появляется новая завершённая партия, приложение само её разбирает и показывает уведомление macOS: «Партия против X разобрана: точность 84%». В архив попадают только завершённые партии, это важно (см. раздел 12).

Также принимать: вставку PGN, перетаскивание .pgn файла на окно, вставку FEN (разбор одной позиции в режиме свободного анализа), ссылку на партию chess.com (вытащить ник и id, найти партию в архивах).

## 8. Дебюты

### 8.1. База
Репозиторий **lichess-org/chess-openings** (лицензия CC0): файлы `a.tsv … e.tsv`, колонки `eco`, `name`, `pgn`, ~3500 названных вариантов от A00 до E99. Скачать при разработке в `resources/openings/`. При первом запуске построить индекс: для каждой строки прогнать ходы через chess.js, сохранить EPD каждой позиции и `uci`-последовательность в sqlite.
Названия английские: сделать словарь перевода для семейств и частых слов (Sicilian Defense → Сицилианская защита, Slav Defense → Славянская защита, Queen's Gambit Declined → Отказанный ферзевый гамбит, Variation → вариант, Attack → атака, Gambit → гамбит и т.д.), непереведённые хвосты оставлять как есть.

### 8.2. Определение дебюта в партии
Идти по позициям партии, на каждой искать EPD в индексе (транспозиции учитываются автоматически). Название = последнее совпадение. «Вышли из теории на ходу N» = первая позиция без совпадения. Ходы до этой точки помечать классом «Книжный».

### 8.3. Обозреватель дебютов (экран «Дебюты»)
- Слева дерево: семейство (по ECO-группам и названию до двоеточия) → варианты → подварианты, поиск по названию на русском и английском, по ECO, по ходам («e4 c5 Nf3»).
- По центру доска: ходы варианта проигрываются с анимацией, кнопки ‹ ›, автопроигрывание с регулируемой скоростью, можно отойти от варианта и сделать свой ход (дерево подсветит, в какой вариант попали).
- Справа гайд (8.4) и оценка движка конечной позиции варианта с топ-3 продолжениями.
- Кнопка «Тренировать»: режим заучивания (8.5).
- Отметка «Мой репертуар»: можно добавить вариант в свой репертуар за белых или чёрных.

### 8.4. Гайды: плюсы, минусы, ловушки, нюансы
Гайды хранить в `resources/openings/guides.json`. Структура:
```json
{
  "family": "Славянская защита",
  "match": { "eco": ["D10-D19"], "namePrefix": ["Slav Defense"] },
  "idea": "…",
  "pros": ["…"],
  "cons": ["…"],
  "plansWhite": ["…"],
  "plansBlack": ["…"],
  "pawnStructure": "…",
  "traps": [ { "name": "…", "forSide": "w|b", "line": "1. d4 d5 2. c4 c6 …", "explanation": "…" } ],
  "nuances": ["…"],
  "typicalMistakes": ["…"]
}
```
Напиши гайды минимум для 80 главных семейств (все популярные: Итальянская, Испанская, Сицилианская с основными системами, Французская, Каро-Канн, Скандинавская, Пирц/Современная, Алёхина, Ферзевый гамбит принятый и отказанный, Славянская и Полуславянская, Каталонская, Новоиндийская, Нимцовича, Староиндийская, Грюнфельд, Голландская, Бенони, Бенко, Лондонская система, Английское начало, Рети, Королевский гамбит, Венская, Шотландская, Русская партия, Филидора, Защита двух коней, Будапештский гамбит, Энглунд, Сокольский, Ларсен, Берд и др.).
**Обязательная проверка каждой ловушки и каждого варианта в гайдах:** скрипт `scripts/verify-guides.ts` проигрывает все линии через chess.js (все ходы легальны) и оценивает конечную позицию Stockfish на глубине ≥20; утверждение в объяснении («белые выигрывают ферзя», «мат») должно подтверждаться оценкой. Если не подтверждается, исправь линию или убери ловушку. Ни одной непроверенной линии в релизе.
Для вариантов без собственного гайда показывать гайд семейства и автоматические факты: оценку движка, структуру пешек (изолированная/висячие/сдвоенные), кто рокировался, материал.

### 8.5. Тренажёр дебютов
Пользователь выбирает вариант или свой репертуар и цвет. Программа делает ходы соперника по линии, пользователь должен найти книжный ход. Ошибся: показать правильный ход стрелкой и объяснение из гайда. Интервальные повторения (SM-2): трудные варианты возвращаются чаще.

## 9. Комментарии движка

### 9.1. К каждому ходу (на русском, по правилам)
На основе: потери wp, класса, лучшего хода, PV, опровержения (первый ход PV из позиции после хода) и простых признаков позиции. Шаблоны (примеры, сделать 40+ разнообразных формулировок):
- Взятие или упущенное взятие: «Можно было забрать слона на e5».
- Зевок фигуры: фигура после хода атакована и не защищена или атакована фигурой меньшей ценности (посчитать SEE по полю).
- Опровержение — вилка: первый ход PV соперника атакует две фигуры ценнее себя или короля и фигуру.
- Мат: «После этого хода у соперника мат в 3».
- Дебютные принципы: ранний вывод ферзя, повторный ход одной фигурой в первых 10 ходах, король не рокировался к 12-му ходу, ход флангового пешкой вместо развития.
- Пешечная структура: появились сдвоенные/изолированные пешки.
- Эндшпиль: пассивный король, упущенная проходная.
Объяснение ошибок как в прототипе (Приложение A, функция `explain`): что сыграно, как изменилась оценка, что было сильнее с вариантом, чем соперник мог ответить и нашёл ли он этот ход.

### 9.2. Итог партии
Абзац-резюме: дебют и где вышли из теории, точность и рейтинг игры каждой стороны, переломный момент (ход с наибольшим скачком wp), лучший ход партии (самый ценный «Лучший»/«Отличная находка»), повторяющиеся темы ошибок (например, «три раза оставляли пешку d5 без защиты»: группировать ошибки по полю или типу), совет на следующую партию.

### 9.3. AI-тренер (опционально, выключено по умолчанию)
В настройках поле для ключа Anthropic API (хранить через Electron `safeStorage`). Если ключ есть, кнопка «Разбор от тренера»: отправить в Claude API структурированный JSON партии (ходы, оценки, классы, дебют, правила 9.1 уже посчитаны) и попросить живой разбор на русском. Модель выбирать в настройках, по умолчанию актуальная Claude Sonnet. Показывать примерную стоимость запроса. Без ключа всё остальное работает полностью офлайн.

## 10. Экран «Разбор» (главный)
Компоновка как в прототипе и как Game Review на chess.com: доска со шкалой оценки слева; справа карточки игроков (точность, рейтинг игры, счётчики классов со значками), итог, «Ключевые моменты», список ходов со значками классов, график оценки внизу (клик → переход, точки на ошибках). Над доской название дебюта. Режимы просмотра: «Обзор» (только ключевые моменты, кнопка «Следующая ошибка»), «Все ходы». Кнопка «Повторить ошибку»: открыть позицию перед ошибкой и предложить найти лучший ход самому (3 попытки, потом подсказка стрелкой). Горячие клавиши: ← → Home End, F — перевернуть, Space — автопроигрывание, B — стрелка лучшего хода.

## 11. Дополнительные фичи
1. **Свободный анализ:** любая позиция (из партии или FEN), ходы мышью, движок с MultiPV, вкладки вариантов, возврат к основной линии.
2. **Тренажёр по своим ошибкам:** все позиции, где пользователь сделал ошибку/зевок/пропуск, собираются в задачник. Решаешь: «найди лучший ход». Интервальные повторения. Статистика по темам (вилки, связки, висящие фигуры, мат).
3. **Статистика:** по всем импортированным партиям: точность по времени (график), результаты по дебютам за белых и чёрных, на каком ходу чаще всего первая серьёзная ошибка, точность по контролю времени, сравнение «быстро сыгранные ходы против долгих» (если в PGN есть `[%clk]`: можно посчитать время на ход и показать, что зевки чаще в цейтноте).
4. **Экспорт:** аннотированный PGN (оценки `[%eval]`, NAG `?!` `?` `??`, комментарии) для загрузки обратно в анализ chess.com; PNG позиции.
5. **Сравнение с собой:** «Эта партия: точность 88% — выше твоей средней за месяц на 6%».

## 12. Чего НЕ делать
- **Никакого распознавания доски с экрана и никакого анализа текущей, ещё идущей партии.** Программа, которая сама считывает живую доску с экрана и показывает ходы движка, — это классический инструмент для читерства. На chess.com это нарушение правил fair play и ведёт к бану аккаунта, и отличить «я просто посмотрю после партии» от игры с подсказками такая функция не может. Удобство «без вписывания» даёт автоотслеживание из раздела 7: API отдаёт только завершённые партии, поэтому разбор появляется сам сразу после партии.
- Не копировать графику, звуки и шрифты chess.com.
- Не отправлять данные никуда, кроме api.chess.com (и Anthropic API, если пользователь сам включил тренера).

## 13. Упаковка для macOS
- `electron-builder`: `mac.target: [dmg, zip]`, `arch: arm64`, `extraResources: resources/**` (включая `bin/stockfish`, права на исполнение сохранить), `productName: "Разбор партий"`, `appId: "local.arsen.razbor"`.
- Подпись ad-hoc (`mac.identity: "-"` или после сборки `codesign --force --deep -s - "dist/mac-arm64/Разбор партий.app"`), иначе на Apple Silicon приложение не запустится.
- Иконка: сгенерировать свою (силуэт коня на сером квадрате со скруглением) в 1024×1024, собрать `.icns` через `iconutil`.
- Путь к движку в собранном приложении: `path.join(process.resourcesPath, 'bin', 'stockfish')`.
- Критерий: `npm run dist` даёт `.dmg`, приложение ставится в /Applications и работает без терминала.

## 14. Тесты (vitest)
- Парсер PGN: русская нотация, комментарии, варианты, `[%clk]`, FEN-заголовок, ошибочный ход даёт понятную ошибку с номером хода.
- `wp`, `accuracy`, классификация на синтетических оценках.
- Определение дебюта: 10 известных последовательностей, включая транспозиции (например, 1. Nf3 d5 2. d4 → ферзевые начала).
- Партия из Приложения B: дебют распознан как Slav Defense (D15), у чёрных самый дорогой ход 11...b6.

---

## Приложение B. Эталонная партия для проверки

Пользователь играл чёрными. Разбор полным Stockfish 17.1 на глубине 20 (строгий профиль из прототипа):

```
1. d4 d5 2. c4 c6 3. Кc3 Кf6 4. Кf3 Кbd7 5. Сg5 h6 6. Сh4 g5 7. Сg3 Кh5 8. e3 Кxg3 9. hxg3 Сg7 10. Сd3 O-O 11. Сc2 b6 12. Фd3 Кf6 13. e4 dxe4 14. Кxe4 Кxe4 15. Фxe4 f5 16. Фd3 c5 17. g4 cxd4 18. gxf5 Сxf5 19. Фd2 Сxc2 20. Фxc2 d3 21. Фd2 Фd6 22. O-O-O Лad8 23. Лhe1 Лf7 24. Фe3 Фf4 25. Кe5 Сxe5
```

Ошибки чёрных (ход, лучше было, падение шанса на победу):
- 7...Кh5 → 7...Кe4, −8
- 9...Сg7 → 9...e6, −8
- 10...O-O → 10...e6, −9
- 11...b6 → 11...dxc4, −19 (самый дорогой)
- 23...Лf7 → 23...Лf4, −8
- 24...Фf4 → 24...g4, −12

Ошибки белых: 11. Сc2 (лучше 11. cxd5, −15), 17. g4 (лучше 17. O-O-O, −8), 18. gxf5 (лучше 18. Кd2, −15), 24. Фe3 (лучше 24. Лe4, −7), 25. Кe5 (лучше 25. Фxf4, −13).
Финальная оценка −5.8 (чёрные выигрывают). Точность (строгий профиль): белые ≈83%, чёрные ≈88%.
Общая тема ошибок чёрных: с 7-го по 11-й ход пешка d5 была недостаточно защищена (конь d7 перекрывает ферзя, конь ушёл с f6), белые пять ходов подряд могли выиграть её через cxd5. Итог 9.2 должен находить такую тему.

---

## Приложение A. Рабочий прототип (одностраничная версия)

Проверенный код веб-версии: разбор PGN, движок (WASM Stockfish через Web Worker), классификация, объяснения, график, доска на Unicode. В Electron-версии замени Worker на нативный движок через IPC, доску на chessground, остальную логику перенеси в модули `analysis/`. `__SAMPLE__` — место, куда подставлялся заранее посчитанный разбор (массив позиций `{t:"cp"|"M", v, s?, best, pv}`), его можно убрать.

```html
<title>Разбор партий</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+Symbols+2&display=swap">
<script src="https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.js"></script>
<style>
/* layout: board column on the left, verdict and move list on the right; stacks on phones */
:root{
  --bg:#edf0f4;--surface:#f9fafc;--ink:#1a1f28;--muted:#5a6475;--line:#d3d9e2;--accent:#2b5d88;--accent-ink:#ffffff;
  --sq-l:#dfe5ec;--sq-d:#7c92ac;--pc-w:#fbfcfe;--pc-b:#161a21;
  --best:#23855a;--good:#5f8f72;--inacc:#c99410;--mistake:#de7323;--blunder:#c7362c;
  --wfill:#f7f8fa;--bfill:#2a303a;--gridline:#9aa6b6;
  --f-display:"Alegreya",Georgia,"Times New Roman",serif;
  --f-body:"IBM Plex Sans",-apple-system,"Segoe UI",Roboto,sans-serif;
  --f-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --f-piece:"Noto Sans Symbols 2","Segoe UI Symbol","DejaVu Sans","Apple Symbols",serif;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#11141a;--surface:#191e26;--ink:#e5e9ef;--muted:#9aa4b4;--line:#2b323d;--accent:#80b2de;--accent-ink:#0e1520;
  --sq-l:#b6c3d2;--sq-d:#5d7390;--pc-w:#fbfcfe;--pc-b:#161a21;
  --best:#4cbf86;--good:#7fae90;--inacc:#e2b237;--mistake:#ef8c45;--blunder:#ec5b50;
  --wfill:#dfe4eb;--bfill:#232933;--gridline:#5a6576;color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#11141a;--surface:#191e26;--ink:#e5e9ef;--muted:#9aa4b4;--line:#2b323d;--accent:#80b2de;--accent-ink:#0e1520;
  --sq-l:#b6c3d2;--sq-d:#5d7390;--pc-w:#fbfcfe;--pc-b:#161a21;
  --best:#4cbf86;--good:#7fae90;--inacc:#e2b237;--mistake:#ef8c45;--blunder:#ec5b50;
  --wfill:#dfe4eb;--bfill:#232933;--gridline:#5a6576;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.5;
  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 40px}
.wrap{max-width:1180px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
h1,h2,h3{font-family:var(--f-display);text-wrap:balance;margin:0;line-height:1.15}
h1{font-size:2.1rem;font-weight:700}
h2{font-size:1.3rem;font-weight:700}
.sub{color:var(--muted);margin:4px 0 0;max-width:68ch}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
.label{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600}
button,select,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.loader{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px}
.loader textarea{width:100%;min-height:118px;resize:vertical;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;font-family:var(--f-mono);font-size:.84rem;line-height:1.45}
.ctrls{display:flex;flex-direction:column;gap:10px}
.field{display:flex;flex-direction:column;gap:4px}
.field input,.field select{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{border:1px solid var(--line);background:var(--surface);border-radius:8px;padding:8px 14px;font-weight:500}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
.btn:disabled{opacity:.55;cursor:default}
.howto{font-size:.84rem;color:var(--muted);margin:6px 0 0}
.progress{height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.progress>div{height:100%;width:0;background:var(--accent);transition:width .2s}
.msg{font-size:.86rem;color:var(--muted);min-height:1.3em}
.msg.err{color:var(--blunder)}
.filebtn{position:relative;overflow:hidden}
.filebtn input{position:absolute;inset:0;opacity:0;cursor:pointer}

.main{display:grid;grid-template-columns:minmax(0,560px) minmax(0,1fr);gap:20px;align-items:start}
.boardcol,.sidecol{display:flex;flex-direction:column;gap:12px;min-width:0}
.player{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600;font-size:.95rem}
.player .dot{width:12px;height:12px;border-radius:50%;border:1px solid var(--muted);display:inline-block;margin-right:8px;vertical-align:-1px}
.player .dot.w{background:var(--pc-w)}.player .dot.b{background:var(--pc-b)}
.you{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;background:var(--accent);color:var(--accent-ink);border-radius:4px;padding:1px 6px;margin-left:8px}
.bwrap{display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px}
.evalbar{position:relative;border-radius:4px;overflow:hidden;background:var(--bfill);border:1px solid var(--line)}
.evalfill{position:absolute;left:0;right:0;bottom:0;height:50%;background:var(--wfill);transition:height .25s}
.evalbar.flip .evalfill{bottom:auto;top:0}
.evaltxt{position:absolute;left:0;right:0;font-family:var(--f-mono);font-size:.62rem;font-weight:600;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);top:6px;color:var(--wfill)}
.board{position:relative;aspect-ratio:1;max-width:100%;container-type:inline-size;display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);border-radius:4px;overflow:hidden;user-select:none}
.sq{position:relative;display:flex;align-items:center;justify-content:center;font-family:var(--f-piece);font-size:calc(100cqi / 8 * .78);line-height:1}
.sq.l{background:var(--sq-l)}.sq.d{background:var(--sq-d)}
.sq .hl{position:absolute;inset:0;opacity:.42}
.pc{position:relative;z-index:1}
.pc.w{color:var(--pc-w);-webkit-text-stroke:1.4px #161a21;paint-order:stroke fill}
.pc.b{color:var(--pc-b);-webkit-text-stroke:.6px #161a21}
.coord{position:absolute;font-family:var(--f-mono);font-size:calc(100cqi / 8 * .17);font-weight:600;z-index:1;opacity:.85}
.coord.f{right:3px;bottom:1px}.coord.r{left:3px;top:1px}
.sq.l .coord{color:var(--sq-d)}.sq.d .coord{color:var(--sq-l)}
.arrows{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}
.nav{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.nav .btn{padding:6px 12px;font-family:var(--f-mono)}
.nav .spacer{flex:1}
.toggle{display:flex;align-items:center;gap:6px;font-size:.86rem;color:var(--muted)}
.comment{min-height:84px}
.comment p{margin:6px 0 0}
.badge{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:.82rem;border-radius:5px;padding:2px 8px;color:#fff;background:var(--c,var(--muted))}
.mv{font-family:var(--f-mono);font-weight:600}
.pvline{font-family:var(--f-mono);font-size:.86rem;color:var(--muted)}
.graphbox{position:relative;height:130px;border-radius:6px;overflow:hidden;border:1px solid var(--line);cursor:pointer}
.graphbox svg{position:absolute;inset:0;width:100%;height:100%}
.gdot{position:absolute;width:10px;height:10px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid var(--surface);background:var(--c);z-index:2}
.gdot.opp{width:7px;height:7px;opacity:.8}
.gcur{position:absolute;top:0;bottom:0;width:2px;background:var(--accent);z-index:1}
.glabel{position:absolute;right:6px;font-size:.68rem;font-family:var(--f-mono);z-index:2}
.glabel.t{top:4px;color:var(--wfill)}.glabel.b{bottom:4px;color:var(--bfill)}

.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.card .acc{font-family:var(--f-display);font-size:2.4rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.card .acc small{font-size:1rem;color:var(--muted);font-weight:500}
.card.me{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.counts{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin-top:10px;font-size:.86rem;font-variant-numeric:tabular-nums}
.counts span:nth-child(odd){font-family:var(--f-mono);font-weight:600;text-align:right}
.verdict{font-size:.95rem}
.verdict p{margin:6px 0 0}
.list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;text-align:left;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.item:hover{border-color:var(--accent)}
.item .why{color:var(--muted);font-size:.84rem}
.item .loss{font-family:var(--f-mono);font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums}
.sym{display:inline-block;min-width:28px;text-align:center;font-family:var(--f-mono);font-weight:700;color:#fff;background:var(--c);border-radius:5px;padding:1px 4px;font-size:.82rem}
.moves{display:grid;grid-template-columns:40px minmax(0,1fr) minmax(0,1fr);max-height:340px;overflow:auto;font-family:var(--f-mono);font-size:.9rem;border:1px solid var(--line);border-radius:8px}
.moves .no{color:var(--muted);padding:4px 8px;background:var(--bg);text-align:right;font-variant-numeric:tabular-nums}
.moves button{border:0;background:none;text-align:left;padding:4px 8px;display:flex;gap:6px;align-items:center;border-radius:0}
.moves button:hover{background:var(--bg)}
.moves button.cur{background:var(--accent);color:var(--accent-ink)}
.moves .tag{font-weight:700;color:var(--c)}
.moves button.cur .tag{color:inherit}
.legend{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:.82rem;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.empty{color:var(--muted);font-size:.9rem;margin:6px 0 0}
@media (max-width:860px){.main{grid-template-columns:minmax(0,1fr)}.loader{grid-template-columns:minmax(0,1fr)}}
@media (max-width:420px){.cards{grid-template-columns:minmax(0,1fr)}h1{font-size:1.7rem}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>

<div class="wrap">
  <header>
    <h1>Разбор партий</h1>
    <p class="sub">Вставьте PGN партии с chess.com. Stockfish 17.1 проверит каждый ход прямо в браузере и покажет, где вы ошиблись, что было сильнее и чем соперник мог наказать.</p>
  </header>

  <section class="panel loader" aria-label="Загрузка партии">
    <div class="field">
      <label class="label" for="pgn">PGN партии (английская или русская нотация)</label>
      <textarea id="pgn" spellcheck="false"></textarea>
      <p class="howto">На chess.com: откройте партию, нажмите «Поделиться», вкладка PGN, «Скопировать». Можно вставить и просто ходы, как в анализе: «1. d4 d5 2. c4 c6 3. Кc3…».</p>
    </div>
    <div class="ctrls">
      <div class="field">
        <label class="label" for="nick">Ваш ник на chess.com</label>
        <input id="nick" type="text" placeholder="определит цвет по PGN" autocomplete="off">
      </div>
      <div class="field">
        <label class="label" for="side">Я играл</label>
        <select id="side"><option value="auto">Определить по нику</option><option value="w">Белыми</option><option value="b">Чёрными</option></select>
      </div>
      <div class="field">
        <label class="label" for="depth">Глубина анализа</label>
        <select id="depth"><option value="12">12: быстро</option><option value="16" selected>16: обычно</option><option value="20">20: глубоко, медленно</option></select>
      </div>
      <div class="row">
        <button class="btn primary" id="go">Анализировать</button>
        <button class="btn" id="stop" hidden>Остановить</button>
        <span class="btn filebtn">Файл .pgn<input id="file" type="file" accept=".pgn,.txt,text/plain" aria-label="Загрузить файл PGN"></span>
      </div>
      <div class="progress" aria-hidden="true"><div id="bar"></div></div>
      <div class="msg" id="msg" role="status"></div>
    </div>
  </section>

  <section class="main">
    <div class="boardcol">
      <div class="player" id="ptop"></div>
      <div class="bwrap">
        <div class="evalbar" id="evalbar"><div class="evalfill" id="evalfill"></div><span class="evaltxt" id="evaltxt"></span></div>
        <div class="board" id="board" aria-label="Доска"></div>
      </div>
      <div class="player" id="pbot"></div>
      <div class="nav">
        <button class="btn" data-nav="start" aria-label="В начало">|‹</button>
        <button class="btn" data-nav="prev" aria-label="Назад">‹</button>
        <button class="btn" data-nav="next" aria-label="Вперёд">›</button>
        <button class="btn" data-nav="end" aria-label="В конец">›|</button>
        <button class="btn" id="flip">Перевернуть</button>
        <span class="spacer"></span>
        <label class="toggle"><input type="checkbox" id="showbest" checked> лучший ход</label>
        <label class="toggle"><input type="checkbox" id="ru" checked> рус. нотация</label>
      </div>
      <div class="panel comment" id="comment" aria-live="polite"></div>
      <div>
        <div class="label" style="margin-bottom:6px">Оценка по ходу партии (нажмите, чтобы перейти)</div>
        <div class="graphbox" id="graph"></div>
      </div>
    </div>

    <div class="sidecol">
      <div class="cards" id="cards"></div>
      <div class="panel verdict" id="verdict"></div>
      <div class="panel">
        <h2>Ваши ошибки</h2>
        <div class="list" id="mine"></div>
      </div>
      <div class="panel">
        <h2>Ошибки соперника</h2>
        <div class="list" id="theirs"></div>
      </div>
      <div>
        <div class="label" style="margin-bottom:6px">Ходы</div>
        <div class="moves" id="moves"></div>
      </div>
    </div>
  </section>

  <footer class="legend" id="legend"></footer>
</div>

<script>
const SAMPLE_PGN = "1. d4 d5 2. c4 c6 3. Кc3 Кf6 4. Кf3 Кbd7 5. Сg5 h6 6. Сh4 g5 7. Сg3 Кh5 8. e3 Кxg3 9. hxg3 Сg7 10. Сd3 O-O 11. Сc2 b6 12. Фd3 Кf6 13. e4 dxe4 14. Кxe4 Кxe4 15. Фxe4 f5 16. Фd3 c5 17. g4 cxd4 18. gxf5 Сxf5 19. Фd2 Сxc2 20. Фxc2 d3 21. Фd2 Фd6 22. O-O-O Лad8 23. Лhe1 Лf7 24. Фe3 Фf4 25. Кe5 Сxe5";
const SAMPLE_POS = __SAMPLE__;
const CL = {
  best:{name:"Лучший",sym:"★",c:"var(--best)"},
  exc:{name:"Отличный",sym:"!",c:"var(--good)"},
  good:{name:"Хороший",sym:"·",c:"var(--good)"},
  inacc:{name:"Неточность",sym:"?!",c:"var(--inacc)"},
  mist:{name:"Ошибка",sym:"?",c:"var(--mistake)"},
  blund:{name:"Зевок",sym:"??",c:"var(--blunder)"}
};
const BAD = ["inacc","mist","blund"];
const $ = s => document.querySelector(s);
let G = null, cur = 0, flipped = false, engine = null, abortFlag = false, running = false;

const store = {
  get(k){try{return localStorage.getItem("cra."+k)}catch(e){return null}},
  set(k,v){try{localStorage.setItem("cra."+k,v)}catch(e){}}
};

function normTok(t){
  return t.replace(/Кр/g,"K").replace(/К/g,"N").replace(/Ф/g,"Q").replace(/Л/g,"R").replace(/С/g,"B").replace(/[хХ]/g,"x")
    .replace(/^0-0-0/,"O-O-O").replace(/^0-0/,"O-O").replace(/[!?]+/g,"").replace(/e\.p\./,"");
}

function parseGame(text){
  const headers = {};
  text.replace(/\[(\w+)\s+"([^"]*)"\]/g,(m,k,v)=>{headers[k]=v;return ""});
  let body = text.replace(/\[[^\]]*\]/g," ").replace(/\{[^}]*\}/g," ").replace(/;[^\n]*/g," ");
  let prev;
  do{prev=body;body=body.replace(/\([^()]*\)/g," ")}while(body!==prev);
  body = body.replace(/\$\d+/g," ").replace(/\d+\s*\.+/g," ");
  const toks = body.split(/\s+/).filter(t=>t && !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t));
  const start = headers.FEN || new Chess().fen();
  const c = new Chess(start);
  const fens = [c.fen()], moves = [];
  for(const raw of toks){
    const m = c.move(normTok(raw),{sloppy:true});
    if(!m) throw new Error(`Не получилось прочитать ход «${raw}» (после ${moves.length} полуходов). Проверьте, что вставлена вся партия целиком.`);
    moves.push({san:m.san,from:m.from,to:m.to,color:m.color,captured:m.captured||null});
    fens.push(c.fen());
  }
  if(!moves.length) throw new Error("В тексте не нашлось ходов. Вставьте PGN или список ходов.");
  return {headers,fens,moves,pos:new Array(fens.length).fill(null)};
}

function chooseSide(g){
  const sel = $("#side").value, nick = $("#nick").value.trim().toLowerCase();
  if(sel==="w"||sel==="b") return sel;
  if(nick){
    if((g.headers.White||"").toLowerCase()===nick) return "w";
    if((g.headers.Black||"").toLowerCase()===nick) return "b";
  }
  return null;
}

function wp(p){
  if(!p) return 50;
  if(p.t==="M") return p.s>0?100:0;
  const cp = Math.max(-1000,Math.min(1000,p.v));
  return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1);
}
function fmt(p){
  if(!p) return "…";
  if(p.t==="M") return p.v===0 ? "мат" : (p.s>0?"+":"−")+"M"+p.v;
  const x = p.v/100;
  return (x>0?"+":x<0?"−":"")+Math.abs(x).toFixed(1);
}
function N(san){
  if(!san) return "";
  return $("#ru").checked ? san.replace(/K/g,"Кр").replace(/N/g,"К").replace(/B/g,"С").replace(/R/g,"Л").replace(/Q/g,"Ф") : san;
}
function moveLabel(i){
  const f = G.fens[i].split(" ");
  return f[5]+(f[1]==="w"?". ":"... ")+N(G.moves[i].san);
}
function line(k,sans,max=7){
  if(!sans||!sans.length) return "";
  const f = G.fens[k].split(" ");
  let no = +f[5], turn = f[1], out = [];
  sans.slice(0,max).forEach((s,j)=>{
    if(turn==="w") out.push(no+". "+N(s));
    else out.push((j===0?no+"... ":"")+N(s));
    if(turn==="b") no++;
    turn = turn==="w"?"b":"w";
  });
  return out.join(" ");
}

function classify(i){
  const b = G.pos[i], a = G.pos[i+1], m = G.moves[i];
  if(!b||!a) return null;
  const loss = Math.max(0, m.color==="w" ? wp(b)-wp(a) : wp(a)-wp(b));
  let k;
  if(b.best && b.best===m.san) k="best";
  else if(loss<3) k="exc";
  else if(loss<7) k="good";
  else if(loss<12) k="inacc";
  else if(loss<18) k="mist";
  else k="blund";
  const acc = Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*loss)-3.1669));
  return {k,loss,acc};
}

function name(color){
  const h = color==="w" ? G.headers.White : G.headers.Black;
  return h || (color==="w"?"Белые":"Чёрные");
}

function explain(i){
  const c = classify(i), b = G.pos[i], a = G.pos[i+1], m = G.moves[i];
  const mine = G.side ? m.color===G.side : true;
  const who = mine ? "Вы сыграли" : "Соперник сыграл";
  let h = `<span class="badge" style="--c:${CL[c.k].c}">${CL[c.k].name}</span> <span class="mv">${moveLabel(i)}</span>`;
  h += `<p>${who} ${N(m.san)}: оценка ${fmt(b)} → ${fmt(a)}.`;
  if(c.k==="best") h += " Это лучший ход по мнению движка.</p>";
  else if(!BAD.includes(c.k)) h += ` Движок предпочитал ${N(b.best)}, но разница небольшая.</p>`;
  else {
    h += ` Шанс на победу упал на ${c.loss.toFixed(0)}%.</p>`;
    const bm = b.best ? new Chess(G.fens[i]).move(b.best) : null;
    h += `<p>Сильнее было <b class="mv">${N(b.best)}</b>${bm&&bm.captured?" (со взятием)":""} с оценкой ${fmt(b)}.</p>`;
    if(b.pv&&b.pv.length) h += `<p class="pvline">${line(i,b.pv)}</p>`;
    if(a.pv&&a.pv.length){
      const r = new Chess(G.fens[i+1]).move(a.pv[0]);
      const next = G.moves[i+1];
      const found = next && next.san===a.pv[0];
      let t = `Почему плохо: после этого хода ${mine?"соперник":"вы"} мог${mine?"":"ли"} ответить <b class="mv">${N(a.pv[0])}</b>`;
      if(a.t==="M"&&a.v>0) t += `, и там форсированный мат в ${a.v} ход.`;
      else if(r&&r.captured) t += " и выиграть материал.";
      else t += ".";
      if(next) t += found ? (mine?" Соперник так и сыграл.":" Вы нашли этот ход.") : (mine?" Соперник этот ход не нашёл.":" Этот ход вы упустили.");
      h += `<p>${t}</p><p class="pvline">${line(i+1,a.pv)}</p>`;
    }
  }
  return h;
}

/* board */
const GLYPH = {k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};
const sqEls = [];
function buildBoard(){
  const b = $("#board");
  b.innerHTML = "";
  for(let i=0;i<64;i++){const d=document.createElement("div");d.className="sq";b.appendChild(d);sqEls.push(d)}
  const svg = document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 800 800");svg.setAttribute("class","arrows");svg.id="arrows";
  b.appendChild(svg);
}
function sqName(r,c){const file=flipped?7-c:c, rank=flipped?r:7-r;return "abcdefgh"[file]+(rank+1)}
function sqXY(s){const file=s.charCodeAt(0)-97, rank=+s[1]-1;const col=flipped?7-file:file,row=flipped?rank:7-rank;return [col*100+50,row*100+50]}
function arrow(from,to,color,w){
  const [x1,y1]=sqXY(from),[x2,y2]=sqXY(to);
  const dx=x2-x1,dy=y2-y1,L=Math.hypot(dx,dy),ux=dx/L,uy=dy/L,head=36,hw=w*1.6;
  const bx=x2-ux*(head+6),by=y2-uy*(head+6),tx=x2-ux*6,ty=y2-uy*6;
  return `<g opacity=".85"><line x1="${x1}" y1="${y1}" x2="${bx}" y2="${by}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/><polygon fill="${color}" points="${tx},${ty} ${bx-uy*hw},${by+ux*hw} ${bx+uy*hw},${by-ux*hw}"/></g>`;
}
function renderBoard(){
  const c = new Chess(G.fens[cur]);
  const last = cur>0 ? G.moves[cur-1] : null;
  const cls = cur>0 ? classify(cur-1) : null;
  const tint = cls ? CL[cls.k].c : "var(--accent)";
  for(let r=0;r<8;r++)for(let col=0;col<8;col++){
    const el = sqEls[r*8+col], s = sqName(r,col), p = c.get(s);
    const dark = (s.charCodeAt(0)-97 + +s[1])%2===1;
    el.className = "sq "+(dark?"d":"l");
    let h = "";
    if(last && (s===last.from||s===last.to)) h += `<span class="hl" style="background:${tint}"></span>`;
    if(p) h += `<span class="pc ${p.color}">${GLYPH[p.type]}︎</span>`;
    if(r===7) h += `<span class="coord f">${s[0]}</span>`;
    if(col===0) h += `<span class="coord r">${s[1]}</span>`;
    el.innerHTML = h;
  }
  let a = "";
  if($("#showbest").checked && cur>0 && cls && cls.k!=="best"){
    const b = G.pos[cur-1];
    if(b&&b.best){const m=new Chess(G.fens[cur-1]).move(b.best);if(m)a+=arrow(m.from,m.to,"var(--best)",16)}
  }
  $("#arrows").innerHTML = a;
  const p = G.pos[cur], w = wp(p);
  $("#evalfill").style.height = w+"%";
  $("#evalbar").classList.toggle("flip",flipped);
  $("#evaltxt").textContent = fmt(p);
  $("#evaltxt").style.color = w>=50 ? "var(--bfill)" : "var(--wfill)";
  $("#evaltxt").style.top = flipped===(w>=50) ? "6px" : "auto";
  $("#evaltxt").style.bottom = flipped===(w>=50) ? "auto" : "6px";
  const top = flipped?"w":"b", bot = flipped?"b":"w";
  const pl = col => `<span><span class="dot ${col}"></span>${esc(name(col))}${G.side===col?'<span class="you">вы</span>':""}</span>`;
  $("#ptop").innerHTML = pl(top); $("#pbot").innerHTML = pl(bot);
}
function esc(s){return String(s).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]))}

function renderComment(){
  const el = $("#comment");
  if(cur===0){el.innerHTML = `<span class="label">Начальная позиция</span><p>Листайте ходы стрелками ← → на клавиатуре или кнопками под доской. Зелёная стрелка на доске показывает, что движок советовал вместо сыгранного хода.</p>`;return}
  if(!classify(cur-1)){el.innerHTML = `<span class="mv">${moveLabel(cur-1)}</span><p class="empty">Этот ход ещё анализируется.</p>`;return}
  el.innerHTML = explain(cur-1);
}

function renderGraph(){
  const n = G.fens.length-1, g = $("#graph");
  const pts = G.pos.map((p,k)=>p?[k/n*1000,(100-wp(p))*2]:null);
  let d = "", first = null, lastP = null;
  pts.forEach(p=>{if(!p)return;if(!first){first=p;d+=`M${p[0]},200 L${p[0]},${p[1]}`}else d+=` L${p[0]},${p[1]}`;lastP=p});
  const area = first ? `<path d="${d} L${lastP[0]},200 Z" fill="var(--wfill)"/>` : "";
  let html = `<svg viewBox="0 0 1000 200" preserveAspectRatio="none"><rect width="1000" height="200" fill="var(--bfill)"/>${area}<line x1="0" y1="100" x2="1000" y2="100" stroke="var(--gridline)" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/></svg>`;
  html += `<span class="glabel t">чёрные лучше</span><span class="glabel b">белые лучше</span>`;
  G.moves.forEach((m,i)=>{
    const c = classify(i); if(!c||!BAD.includes(c.k)) return;
    if(c.k==="inacc" && G.side && m.color!==G.side) return;
    const mine = !G.side || m.color===G.side;
    html += `<span class="gdot${mine?"":" opp"}" style="--c:${CL[c.k].c};left:${(i+1)/n*100}%;top:${(100-wp(G.pos[i+1]))}%" title="${esc(moveLabel(i))}"></span>`;
  });
  html += `<span class="gcur" style="left:calc(${cur/n*100}% - 1px)"></span>`;
  g.innerHTML = html;
}

function renderMoves(){
  const el = $("#moves"); let h = "";
  const startBlack = G.fens[0].split(" ")[1]==="b";
  let i = 0;
  if(startBlack){h += `<span class="no">${G.fens[0].split(" ")[5]}.</span><span></span>`;}
  while(i<G.moves.length){
    const f = G.fens[i].split(" ");
    if(f[1]==="w") h += `<span class="no">${f[5]}.</span>`;
    const c = classify(i);
    const tag = c&&c.k!=="good"&&c.k!=="exc" ? `<span class="tag" style="--c:${CL[c.k].c}">${c.k==="best"?"★":CL[c.k].sym}</span>` : "";
    h += `<button data-go="${i+1}" class="${cur===i+1?"cur":""}">${N(G.moves[i].san)}${tag}</button>`;
    i++;
  }
  el.innerHTML = h;
  const curEl = el.querySelector(".cur");
  if(curEl){const top=curEl.offsetTop-el.offsetTop, h2=el.clientHeight; if(top<el.scrollTop||top>el.scrollTop+h2-30) el.scrollTop=top-h2/2}
}

function stats(color){
  const s = {n:0,acc:0,best:0,exc:0,good:0,inacc:0,mist:0,blund:0};
  G.moves.forEach((m,i)=>{if(m.color!==color)return;const c=classify(i);if(!c)return;s.n++;s.acc+=c.acc;s[c.k]++});
  s.acc = s.n ? s.acc/s.n : null;
  return s;
}

function renderSummary(){
  const done = G.pos.every(Boolean);
  const card = col => {
    const s = stats(col);
    const rows = [["best","Лучших"],["exc","Отличных"],["good","Хороших"],["inacc","Неточностей"],["mist","Ошибок"],["blund","Зевков"]]
      .map(([k,t])=>`<span style="color:${BAD.includes(k)&&s[k]?CL[k].c:"inherit"}">${s[k]}</span><span>${t}</span>`).join("");
    return `<div class="panel card${G.side===col?" me":""}"><div class="player" style="justify-content:flex-start"><span class="dot ${col}"></span>${esc(name(col))}${G.side===col?'<span class="you">вы</span>':""}</div>
      <div class="label" style="margin-top:10px">Точность</div><div class="acc">${s.acc==null?"…":s.acc.toFixed(1)}<small> %</small></div><div class="counts">${rows}</div></div>`;
  };
  $("#cards").innerHTML = card("w")+card("b");

  const v = $("#verdict");
  if(!done){v.innerHTML = `<h2>Итог</h2><p class="empty">Появится, когда анализ закончится.</p>`;}
  else{
    const side = G.side;
    const all = G.moves.map((m,i)=>({i,m,c:classify(i)}));
    const mine = side ? all.filter(x=>x.m.color===side) : all;
    const worst = mine.filter(x=>BAD.includes(x.c.k)).sort((a,b)=>b.c.loss-a.c.loss)[0];
    const fin = G.pos[G.pos.length-1], fw = wp(fin);
    let res = "";
    if(side){
      const myw = side==="w" ? fw : 100-fw;
      res = myw>75 ? "В финальной позиции у вас решающий перевес." : myw>58 ? "В финальной позиции вы стоите лучше." : myw>=42 ? "Финальная позиция примерно равная." : myw>=25 ? "В финальной позиции вы стоите хуже." : "В финальной позиции у соперника решающий перевес.";
    } else res = "Укажите свой цвет или ник, чтобы увидеть разбор именно ваших ходов.";
    let h = `<h2>Итог</h2><p>${res} Оценка движка: <b class="mv">${fmt(fin)}</b>.</p>`;
    if(worst) h += `<p>Самый дорогой ход: <button class="btn" data-go="${worst.i+1}" style="padding:2px 8px"><span class="mv">${moveLabel(worst.i)}</span></button> (${CL[worst.c.k].name.toLowerCase()}, −${worst.c.loss.toFixed(0)}% шанса). Лучше было ${N(G.pos[worst.i].best)}.</p>`;
    else if(side) h += `<p>Серьёзных ошибок движок у вас не нашёл.</p>`;
    v.innerHTML = h;
  }

  const item = (x,extra) => `<button class="item" data-go="${x.i+1}"><span class="sym" style="--c:${CL[x.c.k].c}">${CL[x.c.k].sym}</span><span><span class="mv">${moveLabel(x.i)}</span> <span class="why">${extra}</span></span><span class="loss">−${x.c.loss.toFixed(0)}%</span></button>`;
  const side = G.side;
  const list = G.moves.map((m,i)=>({i,m,c:classify(i)})).filter(x=>x.c);
  const mineEl = $("#mine"), theirsEl = $("#theirs");
  if(!side){mineEl.innerHTML = `<p class="empty">Выберите, каким цветом вы играли.</p>`;theirsEl.innerHTML="";return}
  const myErr = list.filter(x=>x.m.color===side && BAD.includes(x.c.k));
  mineEl.innerHTML = myErr.length ? myErr.map(x=>item(x,"лучше "+N(G.pos[x.i].best))).join("") : `<p class="empty">${done?"Неточностей нет.":"Анализ идёт…"}</p>`;
  const opErr = list.filter(x=>x.m.color!==side && (x.c.k==="mist"||x.c.k==="blund"));
  theirsEl.innerHTML = opErr.length ? opErr.map(x=>{
    const reply = list.find(y=>y.i===x.i+1);
    let t = "";
    if(reply) t = (reply.c.k==="best"||reply.c.k==="exc") ? "вы наказали" : BAD.includes(reply.c.k) ? `упущено: ${N(G.pos[x.i+1].best)}` : `точнее было ${N(G.pos[x.i+1].best)}`;
    return item(x,t);
  }).join("") : `<p class="empty">${done?"Соперник играл без грубых ошибок.":"Анализ идёт…"}</p>`;
}

function renderLegend(){
  $("#legend").innerHTML = ["best","exc","good","inacc","mist","blund"].map(k=>`<span><span class="sym" style="--c:${CL[k].c}">${CL[k].sym}</span>${CL[k].name}</span>`).join("") +
    `<span>Классы считаются по падению шанса на победу: неточность от 7%, ошибка от 12%, зевок от 18%.</span>`;
}

function renderAll(){ if(!G) return; renderBoard(); renderComment(); renderGraph(); renderMoves(); renderSummary(); }
function go(k){ if(!G) return; cur = Math.max(0,Math.min(G.fens.length-1,k)); renderBoard(); renderComment(); renderGraph(); renderMoves(); }

/* engine */
class Engine{
  constructor(){
    this.w = new Worker("stockfish.js");
    this.wait = null; this.onInfo = null;
    this.w.onmessage = e => this.line(String(e.data));
    this.w.onerror = () => { if(this.wait){const w=this.wait;this.wait=null;w.rej(new Error("worker"))} };
  }
  send(c){this.w.postMessage(c)}
  waitFor(tok,ms){return new Promise((res,rej)=>{this.wait={tok,res,rej};if(ms)setTimeout(()=>{if(this.wait&&this.wait.tok===tok){this.wait=null;rej(new Error("timeout"))}},ms)})}
  line(l){
    if(this.onInfo && l.startsWith("info") && l.includes(" pv ")) this.onInfo(l);
    if(this.wait && l.startsWith(this.wait.tok)){const w=this.wait;this.wait=null;w.res(l)}
  }
  async init(){this.send("uci");await this.waitFor("uciok",30000);this.send("setoption name Hash value 32");this.send("isready");await this.waitFor("readyok",30000)}
  async analyse(fen,depth){
    let last = null; this.onInfo = l => {last = l};
    this.send("position fen "+fen); this.send("go depth "+depth);
    const bm = await this.waitFor("bestmove");
    this.onInfo = null;
    const turn = fen.split(" ")[1], sign = turn==="w"?1:-1;
    let p = {t:"cp",v:0,best:null,pv:[]};
    if(last){
      const sc = last.match(/score (cp|mate) (-?\d+)/);
      if(sc){
        const v = +sc[2]*sign;
        p = sc[1]==="cp" ? {t:"cp",v} : {t:"M",v:Math.abs(v),s:Math.sign(v)||sign*-1};
      }
      const pvm = last.match(/ pv (.+)$/);
      const ucis = pvm ? pvm[1].trim().split(/\s+/) : [bm.split(" ")[1]];
      const c = new Chess(fen), sans = [];
      for(const u of ucis){const m=c.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});if(!m)break;sans.push(m.san)}
      p.pv = sans; p.best = sans[0]||null;
    }
    return p;
  }
}

async function analyse(){
  if(running) return;
  const msg = $("#msg"); msg.className = "msg";
  let g;
  try{ g = parseGame($("#pgn").value); }catch(e){ msg.className="msg err"; msg.textContent = e.message; return; }
  g.side = chooseSide(g);
  if(!g.side && $("#side").value==="auto"){
    msg.className = "msg err";
    msg.textContent = $("#nick").value.trim() ? "Ник не найден в заголовках PGN. Выберите цвет вручную." : "Укажите ник или выберите, каким цветом вы играли.";
    return;
  }
  store.set("pgn",$("#pgn").value); store.set("nick",$("#nick").value); store.set("side",$("#side").value); store.set("depth",$("#depth").value);
  G = g; flipped = g.side==="b"; cur = 0; renderAll();
  running = true; abortFlag = false;
  $("#go").disabled = true; $("#stop").hidden = false;
  const depth = +$("#depth").value, n = G.fens.length;
  try{
    if(!engine){ msg.textContent = "Запускаю Stockfish…"; engine = new Engine(); await engine.init(); }
    for(let k=0;k<n;k++){
      if(abortFlag) break;
      const fen = G.fens[k], c = new Chess(fen);
      if(c.in_checkmate()) G.pos[k] = {t:"M",v:0,s:c.turn()==="w"?-1:1,best:null,pv:[]};
      else if(c.in_stalemate()||c.insufficient_material()) G.pos[k] = {t:"cp",v:0,best:null,pv:[]};
      else G.pos[k] = await engine.analyse(fen,depth);
      $("#bar").style.width = ((k+1)/n*100)+"%";
      msg.textContent = `Позиция ${k+1} из ${n}`;
      if(k%4===0||k===n-1){ renderGraph(); renderSummary(); renderMoves(); renderComment(); }
    }
    msg.textContent = abortFlag ? "Анализ остановлен. Разобрано то, что успели." : `Готово: ${G.moves.length} полуходов, глубина ${depth}.`;
  }catch(e){
    engine = null;
    msg.className = "msg err";
    msg.textContent = "Не удалось запустить движок в этом браузере. Попробуйте открыть страницу в Chrome или Firefox на компьютере.";
  }
  running = false; $("#go").disabled = false; $("#stop").hidden = true;
  renderAll();
}

function loadSample(){
  G = parseGame(SAMPLE_PGN);
  G.side = "b"; G.pos = SAMPLE_POS; flipped = true; cur = 0;
  $("#msg").textContent = "Открыта ваша партия, заранее разобранная на глубине 20. Вставьте другую и нажмите «Анализировать».";
  renderAll();
}

document.addEventListener("click",e=>{
  const t = e.target.closest("[data-go]"); if(t){go(+t.dataset.go);return}
  const n = e.target.closest("[data-nav]"); if(n){const a=n.dataset.nav;go(a==="start"?0:a==="prev"?cur-1:a==="next"?cur+1:Infinity)}
});
$("#graph").addEventListener("click",e=>{
  if(!G) return; const r = e.currentTarget.getBoundingClientRect();
  go(Math.round((e.clientX-r.left)/r.width*(G.fens.length-1)));
});
document.addEventListener("keydown",e=>{
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if(e.key==="ArrowLeft"){go(cur-1);e.preventDefault()}
  else if(e.key==="ArrowRight"){go(cur+1);e.preventDefault()}
  else if(e.key==="Home"){go(0);e.preventDefault()}
  else if(e.key==="End"){go(Infinity);e.preventDefault()}
});
$("#flip").addEventListener("click",()=>{flipped=!flipped;renderBoard()});
$("#showbest").addEventListener("change",renderBoard);
$("#ru").addEventListener("change",()=>{store.set("ru",$("#ru").checked?"1":"0");renderAll()});
$("#go").addEventListener("click",analyse);
$("#stop").addEventListener("click",()=>{abortFlag=true});
$("#file").addEventListener("change",e=>{
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader(); r.onload = () => {$("#pgn").value = String(r.result); $("#msg").textContent = `Загружен файл ${f.name}. Нажмите «Анализировать».`}; r.readAsText(f);
});

(function init(){
  buildBoard(); renderLegend();
  if(store.get("ru")==="0") $("#ru").checked = false;
  const nick = store.get("nick"); if(nick) $("#nick").value = nick;
  const side = store.get("side"); if(side) $("#side").value = side;
  const depth = store.get("depth"); if(depth) $("#depth").value = depth;
  $("#pgn").value = SAMPLE_PGN;
  if(typeof Chess==="undefined"){ $("#msg").className="msg err"; $("#msg").textContent="Не загрузилась библиотека шахматных правил. Обновите страницу."; return; }
  loadSample();
})();
</script>

```
