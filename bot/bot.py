import asyncio
import html
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict

try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import websockets
from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    BotCommand,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    TelegramObject,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logging.getLogger("websockets.server").setLevel(logging.CRITICAL)
logging.getLogger("websockets").setLevel(logging.CRITICAL)
logging.getLogger("aiogram").setLevel(logging.WARNING)
log = logging.getLogger("yt-bot")

CONFIG_PATH = Path(__file__).parent / "config.json"
if not CONFIG_PATH.exists():
    raise SystemExit("Создай config.json из config.example.json")

CFG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
TOKEN = CFG["telegramToken"]
OWNER_ID = int(CFG["ownerUserId"])
WS_PORT = int(CFG.get("wsPort", 8765))

# ---- WS ----
clients: Dict[Any, Dict[str, Any]] = {}
pending: Dict[str, asyncio.Future] = {}


def best_client():
    if not clients:
        return None
    return max(
        clients.items(),
        key=lambda kv: (kv[1]["hasVideo"], kv[1]["isYouTube"], kv[1]["lastActivity"]),
    )[0]


async def ws_handler(ws):
    peer = getattr(ws, "remote_address", None)
    log.info(f"WS ext connected from {peer}")
    clients[ws] = {"hasVideo": False, "isYouTube": False, "lastActivity": time.time()}
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "hello":
                clients[ws]["hasVideo"] = bool(msg.get("hasVideo"))
                clients[ws]["isYouTube"] = bool(msg.get("isYouTube"))
                clients[ws]["lastActivity"] = time.time()
                continue
            rid = msg.get("id")
            if rid and rid in pending:
                fut = pending.pop(rid)
                if not fut.done():
                    fut.set_result(msg)
                clients[ws]["lastActivity"] = time.time()
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.pop(ws, None)
        log.info(f"WS ext disconnected {peer}")


async def send_cmd(cmd: str, arg=None, timeout: float = 5.0) -> dict:
    ws = best_client()
    if ws is None:
        return {"ok": False, "error": "Browser offline / нет YouTube вкладки"}
    rid = uuid.uuid4().hex
    fut = asyncio.get_event_loop().create_future()
    pending[rid] = fut
    payload: Dict[str, Any] = {"id": rid, "cmd": cmd}
    if arg is not None:
        payload["arg"] = arg
    try:
        await ws.send(json.dumps(payload))
    except Exception as e:
        pending.pop(rid, None)
        return {"ok": False, "error": f"WS send fail: {e}"}
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        pending.pop(rid, None)
        return {"ok": False, "error": "Таймаут — нет ответа от вкладки"}


# ---- UI ----
BTN_TOGGLE = "⏯ Play / Pause"
BTN_SKIP = "⏭ Скип рекламы"
BTN_REC_START = "🔴 Старт записи"
BTN_REC_END = "🟢 Конец записи"
BTN_STATUS = "📊 Статус"
BTN_CLEAR = "🗑 Очистить сегменты"

SEEK_BUTTONS = {
    "⏪ -60": ("back", 60),
    "⏪ -30": ("back", 30),
    "⏪ -10": ("back", 10),
    "⏩ +10": ("seek", 10),
    "⏩ +30": ("seek", 30),
    "⏩ +60": ("seek", 60),
}


def main_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_TOGGLE), KeyboardButton(text=BTN_SKIP)],
            [KeyboardButton(text="⏪ -60"), KeyboardButton(text="⏪ -30"), KeyboardButton(text="⏪ -10")],
            [KeyboardButton(text="⏩ +10"), KeyboardButton(text="⏩ +30"), KeyboardButton(text="⏩ +60")],
            [KeyboardButton(text=BTN_REC_START), KeyboardButton(text=BTN_REC_END)],
            [KeyboardButton(text=BTN_STATUS), KeyboardButton(text=BTN_CLEAR)],
        ],
        resize_keyboard=True,
        is_persistent=True,
    )


def fmt_time(sec) -> str:
    sec = int(sec or 0)
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def status_text(res: dict) -> str:
    if not res.get("ok"):
        return f"❌ {res.get('error', 'неизвестная ошибка')}"
    r = res.get("result") or {}
    if not r or "currentTime" not in r:
        return "✅ Готово"
    title = html.escape(r.get("title") or "Без названия")
    author = html.escape(r.get("author") or "—")
    cur = fmt_time(r.get("currentTime"))
    dur = fmt_time(r.get("duration")) if r.get("duration") else "?"
    state = "⏸ пауза" if r.get("paused") else "▶ играет"
    segs = r.get("segmentsCount", 0)
    lines = [
        f"🎬 <b>{title}</b>",
        f"👤 {author}",
        f"⏱ {cur} / {dur}   {state}",
    ]
    if segs:
        lines.append(f"🎯 Сегментов: {segs}")
    return "\n".join(lines)


def parse_jump(s: str):
    parts = s.strip().split(":")
    if not all(p.isdigit() for p in parts):
        return None
    parts = [int(p) for p in parts]
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


# ---- Bot ----
bot = Bot(TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()

UNAUTH_SEEN: set = set()


@dp.update.outer_middleware()
async def auth_mw(
    handler: Callable[[TelegramObject, Dict[str, Any]], Awaitable[Any]],
    event: TelegramObject,
    data: Dict[str, Any],
):
    user = None
    if getattr(event, "message", None):
        user = event.message.from_user
    elif getattr(event, "callback_query", None):
        user = event.callback_query.from_user
    if user is None:
        return await handler(event, data)
    if user.id != OWNER_ID:
        if user.id not in UNAUTH_SEEN:
            UNAUTH_SEEN.add(user.id)
            if getattr(event, "message", None):
                try:
                    await event.message.answer("Unauthorized")
                except Exception:
                    pass
        return
    return await handler(event, data)


async def reply_status(msg: Message, prefix: str = ""):
    res = await send_cmd("status")
    text = (prefix + "\n\n" if prefix else "") + status_text(res)
    await msg.answer(text, reply_markup=main_kb())


@dp.message(CommandStart())
@dp.message(Command("menu"))
async def cmd_start(msg: Message):
    await reply_status(msg, "Готов. Управляй кнопками ниже 👇")


@dp.message(Command("help"))
async def cmd_help(msg: Message):
    text = (
        "<b>Управление через кнопки внизу</b>\n\n"
        "Команды:\n"
        "/menu — показать клавиатуру\n"
        "/jump M:SS — прыгнуть на точное время\n"
        "/status — обновить статус"
    )
    await msg.answer(text, reply_markup=main_kb())


@dp.message(Command("jump"))
async def cmd_jump(msg: Message):
    parts = (msg.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await msg.answer("Формат: <code>/jump 1:23</code> или <code>/jump 90</code>", reply_markup=main_kb())
        return
    sec = parse_jump(parts[1])
    if sec is None:
        await msg.answer("Не понял время", reply_markup=main_kb())
        return
    await send_cmd("jumpAbs", sec)
    await reply_status(msg)


@dp.message(Command("status"))
@dp.message(F.text == BTN_STATUS)
async def h_status(msg: Message):
    await reply_status(msg)


@dp.message(F.text == BTN_TOGGLE)
async def h_toggle(msg: Message):
    await send_cmd("toggle")
    await reply_status(msg)


@dp.message(F.text == BTN_SKIP)
async def h_skip(msg: Message):
    r = await send_cmd("skip")
    if not r.get("ok") or r.get("result") is False:
        await msg.answer("Нет ближайших сегментов для скипа.", reply_markup=main_kb())
        return
    await reply_status(msg)


@dp.message(F.text == BTN_REC_START)
async def h_rec_start(msg: Message):
    r = await send_cmd("markStart")
    if r.get("ok"):
        await msg.answer("🔴 Старт сегмента записан. Жми «Конец записи» в конце рекламы.", reply_markup=main_kb())
    else:
        await msg.answer(status_text(r), reply_markup=main_kb())


@dp.message(F.text == BTN_REC_END)
async def h_rec_end(msg: Message):
    r = await send_cmd("markEnd")
    if r.get("ok") and r.get("result"):
        await msg.answer("🟢 Сегмент сохранён + добавлен в паттерны канала.", reply_markup=main_kb())
    else:
        err = r.get("error") or "сначала жми «Старт записи»"
        await msg.answer(f"⚠ {err}", reply_markup=main_kb())


@dp.message(F.text == BTN_CLEAR)
async def h_clear(msg: Message):
    await send_cmd("clear")
    await reply_status(msg, "🗑 Свои сегменты в этом видео очищены.")


@dp.message(F.text.in_(SEEK_BUTTONS.keys()))
async def h_seek(msg: Message):
    cmd, n = SEEK_BUTTONS[msg.text]
    await send_cmd(cmd, n)
    await reply_status(msg)


@dp.message()
async def h_fallback(msg: Message):
    # ignore stray text, but reshow keyboard
    if msg.text and msg.text.startswith("/"):
        await msg.answer("Неизвестная команда. /menu", reply_markup=main_kb())


async def main():
    await bot.set_my_commands([
        BotCommand(command="menu", description="Меню"),
        BotCommand(command="status", description="Статус видео"),
        BotCommand(command="jump", description="Прыгнуть на M:SS"),
        BotCommand(command="help", description="Помощь"),
    ])
    log.info(f"Telegram bot started. Owner={OWNER_ID}. WS port={WS_PORT}")
    async with websockets.serve(ws_handler, "127.0.0.1", WS_PORT):
        log.info(f"WS bridge on ws://127.0.0.1:{WS_PORT}")
        await dp.start_polling(bot, handle_signals=False)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
