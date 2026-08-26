#!/usr/bin/python3
import json
import os
import struct
import subprocess
import tempfile


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = os.path.join(ROOT, "build", "shiyi-native-host")


def frame(message):
    payload = json.dumps(message).encode("utf-8")
    return struct.pack("<I", len(payload)) + payload


def read_response(process):
    header = process.stdout.read(4)
    assert len(header) == 4
    length = struct.unpack("<I", header)[0]
    return json.loads(process.stdout.read(length).decode("utf-8"))


with tempfile.TemporaryDirectory() as directory:
    card = {
        "id": "native-test-card",
        "title": "NDCG",
        "content": "NDCG 衡量排序质量",
        "sourceApp": "Codex",
        "createdAt": "2026-08-27T00:00:00Z",
    }
    with open(os.path.join(directory, "pending.json"), "w", encoding="utf-8") as queue:
        json.dump([card], queue, ensure_ascii=False)

    environment = {**os.environ, "SHIYI_APP_SUPPORT_DIR": directory}
    process = subprocess.Popen(
        [HOST],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
    )
    process.stdin.write(frame({"action": "pull"}))
    process.stdin.flush()
    pulled = read_response(process)
    assert pulled == {"ok": True, "cards": [card]}

    process.stdin.write(frame({"action": "ack", "ids": [card["id"]]}))
    process.stdin.flush()
    acknowledged = read_response(process)
    assert acknowledged == {"ok": True, "cards": []}

    process.stdin.close()
    process.wait(timeout=5)
    with open(os.path.join(directory, "pending.json"), encoding="utf-8") as queue:
        assert json.load(queue) == []

print("native host tests passed")
