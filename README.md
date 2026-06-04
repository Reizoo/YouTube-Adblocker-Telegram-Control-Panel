# YouTube AdBlocker + Telegram Control Panel

Chromium-расширение (Arc / Chrome / Edge) + локальный Telegram-бот для управления YouTube с телефона.

## Что внутри

### Расширение (Manifest V3)
- Блокировка сетевых рекламных запросов (`doubleclick`, `googlesyndication`, `pagead`, `&oad=` и т.п.) через `declarativeNetRequest`.
- Авто-скип преролл/мидролл рекламы YouTube (клик по skip-кнопке или fast-forward до конца).
- Удаление баннеров / "ad-blocker detected" попапов.
- Интеграция с **SponsorBlock** API — авто-скип спонсорских сегментов внутри ролика, цветные маркеры на таймлайне.
- Ручная разметка сегментов хоткеями `[` / `]` (старт / стоп). Сохраняется в `chrome.storage.local` по `videoId`.
- **Паттерн-узнавание рекламы**: при ручной разметке вытягивается транскрипт сегмента, сохраняется fingerprint по `channelId`. На новых видео того же автора похожие сегменты находятся через Jaccard-сходство + n-gram и пропускаются автоматически (цвет `#ff8800` на таймлайне).
- Watchdog для зависших ad-плееров (зацикленный seek + чёрный экран).

### Telegram-бот
- Локальный Python-процесс на ПК. Долгое polling Telegram + WebSocket-мост на `ws://127.0.0.1:8765`.
- Управление YouTube с телефона: play/pause toggle, перемотка ±5/±10/±30/±60, скип спонсора, старт/конец записи рекламы, очистка сегментов, статус.
- Persistent reply-клавиатура с группировкой по контекстам.
- Статус: название, автор, прогресс, состояние.
- Player API дёргается из MAIN world (`movie_player.playVideo()/pauseVideo()/getVideoData()`) — обходит autoplay-policy.
- Авторизация по `ownerUserId` — все остальные игнорятся.

## Структура

```
yt-adblock/
├── manifest.json          MV3 манифест
├── rules.json             declarativeNetRequest правила
├── content.js             авто-скип video ads + watchdog
├── sponsorblock.js        SB API + хоткеи + кастомные сегменты
├── pattern.js             fingerprint-узнавание per channel
├── remote.js              WS-клиент для бота
├── page_world.js          MAIN-world bridge для YT player API
├── styles.css             прячет ad-контейнеры
└── bot/
    ├── bot.py             aiogram бот + websockets сервер
    ├── requirements.txt
    ├── config.example.json
    ├── start.cmd
    └── README.md
```

## Установка

### 1. Расширение

1. `arc://extensions` (или `chrome://extensions`)
2. Включи **Developer mode**
3. **Load unpacked** -> выбери папку проекта (`yt-adblock/`)
4. Перезагрузи открытые YouTube-вкладки

### 2. Telegram-бот

```powershell
cd bot
copy config.example.json config.json
```

Открой `config.json`:
```json
{
  "telegramToken": "123456:ABC...",
  "ownerUserId": 5467371542,
  "wsPort": 8765
}
```
- **telegramToken** — у `@BotFather` -> `/newbot` -> копируй HTTP-токен.
- **ownerUserId** — напиши боту любое сообщение, открой `https://api.telegram.org/bot<TOKEN>/getUpdates`, скопируй `from.id`.

Установка зависимостей + запуск:
```powershell
pip install -r requirements.txt
python bot.py
```
или дабл-клик `start.cmd`.

### 3. Autostart (Windows)

Task Scheduler -> Create Task -> Trigger: At log on -> Action:
`python C:\путь\к\yt-adblock\bot\bot.py`

## Команды Telegram

| Команда | Описание |
|---|---|
| `/menu`, `/start` | показать клавиатуру + статус |
| `/status` | обновить статус |
| `/jump M:SS` | прыгнуть на абсолютное время |
| `/help` | помощь |

### Клавиатура

```
[⏯ Play / Pause]      [⏭ Скип рекламы]
[⏪ -60] [⏪ -30] [⏪ -10]
[⏩ +10] [⏩ +30] [⏩ +60]
[🔴 Старт записи]     [🟢 Конец записи]
[📊 Статус]           [🗑 Очистить сегменты]
```

## Хоткеи в браузере

- `[` — пометить старт рекламного сегмента
- `]` — пометить конец + сохранить
- `\` — удалить свои сегменты для текущего видео

## Цвета маркеров на таймлайне

| Цвет | Категория |
|---|---|
| 🟢 `#00d400` | sponsor (SB API) |
| 🟡 `#ffff00` | selfpromo |
| 🟣 `#cc00ff` | interaction |
| 🔴 `#ff2d2d` | свой ручной сегмент |
| 🟠 `#ff8800` | pattern-detected (паттерн-узнавание) |

## Технологии

- **Расширение**: vanilla JS, Manifest V3, `declarativeNetRequest`, `chrome.storage.local`, MAIN-world content scripts.
- **Bot**: Python 3.12, [aiogram](https://aiogram.dev/) 3.x, `websockets`, `truststore` (для корпоративных SSL).
- **API**: [SponsorBlock](https://sponsor.ajay.app/), YouTube `timedtext` транскрипты, YT player IFrame API.

## Безопасность

- `bot/config.json` в `.gitignore` — токен не утечёт.
- Бот слушает только `127.0.0.1` — снаружи недоступен.
- Авторизация в Telegram по `ownerUserId`.
- Нет внешних API кроме Telegram + SponsorBlock + youtube.com.

## Лицензия

MIT
