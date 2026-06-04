# YT AdBlock — Telegram bot (Python)

Локальный бот + WebSocket мост. Управляет YouTube в Arc через Telegram.

## Setup

1. `copy config.example.json config.json`
2. У @BotFather -> `/newbot` -> вставь токен в `telegramToken`.
3. Напиши боту любое сообщение, открой `https://api.telegram.org/bot<TOKEN>/getUpdates`, скопируй `from.id` -> `ownerUserId`.
4. `pip install -r requirements.txt`
5. `python bot.py` (или `start.cmd`).

Расширение в Arc подключится к `ws://127.0.0.1:8765` автоматом.

## Команды

| Команда | Что делает |
|---|---|
| `/play` `/pause` | воспроизв / пауза |
| `/fwd N` | вперёд N сек (def 30) |
| `/back N` | назад N сек |
| `/jump M:SS` | абсолютное время |
| `/rs` | начать запись рекламы (markStart) |
| `/re` | закончить запись + сохранить fingerprint |
| `/skip` | пропустить ближайший спонсор |
| `/clear` | удалить свои сегменты текущего видео |
| `/status` | что идёт сейчас |
| `/menu` | inline-кнопки |

## Autostart (Windows)

Task Scheduler -> Create Task -> Trigger: At log on -> Action:
`python C:\Users\Reiz\Desktop\adblocker\yt-adblock\bot\bot.py`.
