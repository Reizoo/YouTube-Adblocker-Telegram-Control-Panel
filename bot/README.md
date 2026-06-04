# Telegram bot bridge

Local Python process. Long-polls Telegram and runs a WebSocket bridge on
`ws://127.0.0.1:8765` that the browser extension connects to.

## Setup

1. `copy config.example.json config.json`
2. Open `@BotFather` → `/newbot` → paste the HTTP token into `telegramToken`.
3. Message your new bot once, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `from.id` into
   `ownerUserId`.
4. `pip install -r requirements.txt`
5. `python bot.py` (or double-click `start.cmd`).

The extension auto-connects to `ws://127.0.0.1:8765`.

## Telegram commands

| Command | What it does |
|---|---|
| `/menu`, `/start` | Show the reply keyboard + status |
| `/status` | Refresh status |
| `/jump M:SS` | Seek to absolute time |
| `/help` | Help |

### Keyboard

```
[⏯ Play / Pause]      [⏭ Skip sponsor]
[⏪ -60] [⏪ -30] [⏪ -10]
[⏩ +10] [⏩ +30] [⏩ +60]
[🔴 Record start]     [🟢 Record end]
[📊 Status]           [🗑 Clear segments]
```

## Autostart on Windows

Task Scheduler → Create Task → Trigger: *At log on* → Action:
`python C:\path\to\yt-adblock\bot\bot.py`

## How it talks to the extension

The content script `remote.js` opens a WebSocket to `127.0.0.1:8765` from any
youtube.com tab and reconnects every 3 s. If multiple tabs are connected, the
bot prefers the one whose latest `hello` / `status` showed an active video.

If no tab is connected, the bot replies with `Browser offline / no YT tab`
after a 5 s timeout.
