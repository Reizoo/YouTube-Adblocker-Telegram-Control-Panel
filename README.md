# YouTube AdBlocker + Telegram Control Panel

A Chromium extension (Arc / Chrome / Edge) plus a local Telegram bot to control YouTube playback from your phone.

[Русская версия](./README.ru.md)

## Features

### Browser extension (Manifest V3)
- Network-level ad blocking via `declarativeNetRequest` (`doubleclick`, `googlesyndication`, `pagead`, `&oad=`, etc.).
- Auto-skip of YouTube pre-roll / mid-roll ads (click the skip button, or fast-forward to the end with a stall watchdog).
- Hides banners, masthead ads, and the "ad blocker detected" popup.
- **SponsorBlock** API integration — auto-skips in-video sponsor segments and renders colored markers on the timeline.
- Manual segment marking via `[` / `]` hotkeys (start / end). Stored in `chrome.storage.local` keyed by `videoId`.
- **Cross-video ad pattern recognition**: when you mark a segment, its transcript is fingerprinted and stored per `channelId`. On new videos by the same author, the transcript is scanned for similar segments (Jaccard similarity + n-gram match) and they are auto-skipped (orange marker `#ff8800`).
- Watchdog for stuck ad players (loops the seek + freezes on black screen).

### Telegram bot
- Local Python process on your PC. Long-polls Telegram and runs a WebSocket bridge on `ws://127.0.0.1:8765`.
- Phone-side controls: play/pause toggle, seek ±10 / ±30 / ±60, skip-to-end-of-sponsor, start/stop ad recording, clear segments, status.
- Persistent reply keyboard grouped by context.
- Status card: video title, author, progress, playback state, segment count.
- Driven via the YT player MAIN-world API (`movie_player.playVideo()/pauseVideo()/getVideoData()`) — bypasses autoplay-policy restrictions.
- Single-owner authorization via `ownerUserId` — all other Telegram accounts are ignored.

## Repository layout

```
yt-adblock/
├── manifest.json          MV3 manifest
├── rules.json             declarativeNetRequest rules
├── content.js             video-ad auto-skip + stall watchdog
├── sponsorblock.js        SponsorBlock API + hotkeys + custom segments
├── pattern.js             per-channel transcript fingerprint matching
├── remote.js              WebSocket client for the bot bridge
├── page_world.js          MAIN-world bridge for the YT player API
├── styles.css             hides ad containers
└── bot/
    ├── bot.py             aiogram bot + websockets server
    ├── requirements.txt
    ├── config.example.json
    ├── start.cmd
    └── README.md
```

## Setup

### 1. Install the extension

1. Open `arc://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick the project folder (`yt-adblock/`).
4. Reload any open YouTube tabs.

### 2. Configure the Telegram bot

```powershell
cd bot
copy config.example.json config.json
```

Edit `config.json`:
```json
{
  "telegramToken": "123456:ABC...",
  "ownerUserId": 5467371542,
  "wsPort": 8765
}
```
- **telegramToken** — from `@BotFather` → `/newbot` → copy the HTTP API token.
- **ownerUserId** — message your new bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `from.id`.

Install deps and run:
```powershell
pip install -r requirements.txt
python bot.py
```
Or double-click `start.cmd`.

### 3. Autostart on Windows

Task Scheduler → Create Task → Trigger: *At log on* → Action:
`python C:\path\to\yt-adblock\bot\bot.py`

## Telegram commands

| Command | Description |
|---|---|
| `/menu`, `/start` | Show keyboard + status |
| `/status` | Refresh status |
| `/jump M:SS` | Jump to absolute time |
| `/help` | Help |

### Keyboard

```
[⏯ Play / Pause]      [⏭ Skip sponsor]
[⏪ -60] [⏪ -30] [⏪ -10]
[⏩ +10] [⏩ +30] [⏩ +60]
[🔴 Record start]     [🟢 Record end]
[📊 Status]           [🗑 Clear segments]
```

## Browser hotkeys

- `[` — mark the start of an ad segment
- `]` — mark the end and save
- `\` — clear your manual segments for the current video

## Timeline marker colors

| Color | Category |
|---|---|
| 🟢 `#00d400` | sponsor (SponsorBlock API) |
| 🟡 `#ffff00` | selfpromo |
| 🟣 `#cc00ff` | interaction reminder |
| 🔴 `#ff2d2d` | your manual segment |
| 🟠 `#ff8800` | pattern-detected (cross-video recognition) |

## Tech stack

- **Extension**: vanilla JS, Manifest V3, `declarativeNetRequest`, `chrome.storage.local`, MAIN-world content scripts.
- **Bot**: Python 3.12, [aiogram](https://aiogram.dev/) 3.x, `websockets`, `truststore` (for corporate SSL inspection).
- **External APIs**: [SponsorBlock](https://sponsor.ajay.app/), YouTube `timedtext` transcripts, YT IFrame Player API.

## Security

- `bot/config.json` is in `.gitignore` — your token never reaches Git.
- The bot listens on `127.0.0.1` only — no external exposure.
- Telegram side is gated by `ownerUserId`; unauthorized senders are silently dropped (after one polite "Unauthorized" reply).
- No third-party APIs other than Telegram, SponsorBlock, and youtube.com itself.

## License

MIT — see [LICENSE](./LICENSE).
