#!/usr/bin/python3
import fcntl
import json
import os
import struct
import sys
import tempfile


BASE_DIR = os.environ.get(
    "SHIYI_APP_SUPPORT_DIR",
    os.path.expanduser("~/Library/Application Support/ShiyiCard"),
)
QUEUE_PATH = os.path.join(BASE_DIR, "pending.json")
LOCK_PATH = os.path.join(BASE_DIR, "pending.lock")


def locked_queue(update=None):
    os.makedirs(BASE_DIR, exist_ok=True)
    with open(LOCK_PATH, "a+b") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as queue_file:
                cards = json.load(queue_file)
        except (FileNotFoundError, json.JSONDecodeError):
            cards = []
        if update is not None:
            cards = update(cards)
            file_descriptor, temp_path = tempfile.mkstemp(dir=BASE_DIR, prefix="pending-", suffix=".json")
            try:
                with os.fdopen(file_descriptor, "w", encoding="utf-8") as temp_file:
                    json.dump(cards, temp_file, ensure_ascii=False, separators=(",", ":"))
                os.replace(temp_path, QUEUE_PATH)
            finally:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
        return cards


def handle(request):
    action = request.get("action")
    if action == "pull":
        return {"ok": True, "cards": locked_queue()}
    if action == "ack":
        acknowledged = set(request.get("ids") or [])
        locked_queue(lambda cards: [card for card in cards if card.get("id") not in acknowledged])
        return {"ok": True, "cards": []}
    return {"ok": False, "error": "Unknown action"}


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    length = struct.unpack("<I", header)[0]
    if length <= 0 or length > 10_000_000:
        return None
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        return None
    return json.loads(payload.decode("utf-8"))


def write_message(response):
    payload = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


while True:
    try:
        message = read_message()
        if message is None:
            break
        write_message(handle(message))
    except Exception as error:
        write_message({"ok": False, "error": str(error)})
