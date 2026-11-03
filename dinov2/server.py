"""HTTP service the VRT backend asks whether two screenshots differ in content.

POST /v1/patch-distances   (X-Timeout-Ms: how long the caller will wait; 503 once it is over)
  {"baseline": "<base64 PNG>", "image": "<base64 PNG>",
   "tiles": [[row, col], ...]}   (optional: 224 px tiles to encode, default all)
  -> {"patch": 14, "width": <patches across>, "height": <patches down>,
      "distances": [<row-major cosine distances>]}
  -> 413 over DINOV2_MAX_PIXELS per image, 503 when the queue (DINOV2_MAX_QUEUE) is full
GET /health -> {"status": "ok", "model": "<model id>"}

It only measures; deciding what the distances mean (where to look, what
threshold) is the backend's job, so that logic is tested and versioned there.
"""
import binascii
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort

from guard import Busy, Gate, TooLarge, open_image
from patches import PATCH, patch_distances

MODEL_PATH = os.environ.get("DINOV2_MODEL_PATH", "/model/dinov2-base.onnx")
MODEL_ID = os.environ.get("DINOV2_MODEL_ID", "facebook/dinov2-base")
PORT = int(os.environ.get("PORT", "8000"))
# two decoded 1280x10000 screenshots are ~75 MB of base64; anything far beyond
# that is not a screenshot pair
MAX_BODY = int(os.environ.get("DINOV2_MAX_BODY_BYTES", str(200 * 1024 * 1024)))
# per image, sized for 2 GB of RAM
MAX_PIXELS = int(os.environ.get("DINOV2_MAX_PIXELS", "20000000"))
# requests allowed to wait for the one compute slot; the rest are refused at once
MAX_QUEUE = int(os.environ.get("DINOV2_MAX_QUEUE", "2"))

# onnxruntime's default — one thread per visible core — oversubscribes a
# container's CPU share and ran up to 7x slower than 4 threads when measured
THREADS = int(os.environ.get("DINOV2_THREADS", "4"))
options = ort.SessionOptions()
options.intra_op_num_threads = THREADS
session = ort.InferenceSession(MODEL_PATH, options, providers=["CPUExecutionProvider"])
# the CLS token comes first; the patches follow, row by row
encode = lambda x: session.run(None, {"pixel_values": x})[0][:, 1:]  # noqa: E731
# one pair at a time (onnxruntime already spreads a run over every core), reading and decoding included
gate = Gate(MAX_QUEUE)


def deadline_of(header: str | None, started: float) -> float | None:
    try:
        return started + int(header) / 1000 if header else None
    except ValueError:
        return None


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": MODEL_ID})
        else:
            self._send(404, {"error": "not found"})

    def _measure(self, length: int, check):
        body = json.loads(self.rfile.read(length))
        opened = [open_image(body[key], MAX_PIXELS) for key in ("baseline", "image")]
        baseline, image = (np.asarray(each.convert("RGB")) for each in opened)

        def checked(x):
            check()
            return encode(x)

        only = body.get("tiles")
        if only is not None:
            only = [(int(r), int(c)) for r, c in only]
        return patch_distances(baseline, image, checked, only)

    def do_POST(self) -> None:
        if self.path != "/v1/patch-distances":
            self._send(404, {"error": "not found"})
            return
        started = time.monotonic()
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(413 if length > MAX_BODY else 400, {"error": "body missing or too large"})
            return
        try:
            with gate.slot(deadline_of(self.headers.get("X-Timeout-Ms"), started)) as check:
                distances = self._measure(length, check)
        except Busy as error:
            self.close_connection = True
            self._send(503, {"error": str(error)})
            return
        except TooLarge as error:
            self._send(413, {"error": str(error)})
            return
        except (KeyError, TypeError, ValueError, binascii.Error, OSError) as error:
            self._send(400, {"error": f"expected two base64 PNGs: {error}"})
            return
        height, width = distances.shape
        self._send(200, {"patch": PATCH, "width": width, "height": height,
                         "distances": [round(float(d), 5) for d in distances.ravel()]})

    def log_message(self, fmt: str, *args) -> None:  # one line per request, no bodies
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"dinov2 service: {MODEL_ID} from {MODEL_PATH} on :{PORT}, {THREADS} threads", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
