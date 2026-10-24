"""HTTP service the VRT backend asks whether two screenshots differ in content.

POST /v1/patch-distances
  {"baseline": "<base64 PNG>", "image": "<base64 PNG>",
   "tiles": [[row, col], ...]}   (optional: 224 px tiles to encode, default all)
  -> {"patch": 14, "width": <patches across>, "height": <patches down>,
      "distances": [<row-major cosine distances>]}
GET /health -> {"status": "ok", "model": "<model id>"}

It only measures; deciding what the distances mean (where to look, what
threshold) is the backend's job, so that logic is tested and versioned there.
"""
import base64
import binascii
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from PIL import Image

from patches import PATCH, patch_distances

MODEL_PATH = os.environ.get("DINOV2_MODEL_PATH", "/model/dinov2-base.onnx")
MODEL_ID = os.environ.get("DINOV2_MODEL_ID", "facebook/dinov2-base")
PORT = int(os.environ.get("PORT", "8000"))
# two decoded 1280x10000 screenshots are ~75 MB of base64; anything far beyond
# that is not a screenshot pair
MAX_BODY = int(os.environ.get("DINOV2_MAX_BODY_BYTES", str(200 * 1024 * 1024)))

# onnxruntime's default — one thread per visible core — oversubscribes a
# container's CPU share and ran up to 7x slower than 4 threads when measured
THREADS = int(os.environ.get("DINOV2_THREADS", "4"))
options = ort.SessionOptions()
options.intra_op_num_threads = THREADS
session = ort.InferenceSession(MODEL_PATH, options, providers=["CPUExecutionProvider"])
# the CLS token comes first; the patches follow, row by row
encode = lambda x: session.run(None, {"pixel_values": x})[0][:, 1:]  # noqa: E731
# one pair at a time: onnxruntime already spreads a run over every core
lock = threading.Lock()


def decode(field: str) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(field, validate=True))).convert("RGB"))


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

    def do_POST(self) -> None:
        if self.path != "/v1/patch-distances":
            self._send(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._send(413 if length > MAX_BODY else 400, {"error": "body missing or too large"})
            return
        try:
            body = json.loads(self.rfile.read(length))
            baseline, image = decode(body["baseline"]), decode(body["image"])
            only = body.get("tiles")
            if only is not None:
                only = [(int(r), int(c)) for r, c in only]
        except (KeyError, TypeError, ValueError, binascii.Error, OSError) as error:
            self._send(400, {"error": f"expected two base64 PNGs: {error}"})
            return
        try:
            with lock:
                distances = patch_distances(baseline, image, encode, only)
        except ValueError as error:
            self._send(400, {"error": str(error)})
            return
        height, width = distances.shape
        self._send(200, {"patch": PATCH, "width": width, "height": height,
                         "distances": [round(float(d), 5) for d in distances.ravel()]})

    def log_message(self, fmt: str, *args) -> None:  # one line per request, no bodies
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    print(f"dinov2 service: {MODEL_ID} from {MODEL_PATH} on :{PORT}, {THREADS} threads", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
