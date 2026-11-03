"""Input size cap and a bounded, deadline-aware compute slot."""
import base64
import contextlib
import io
import threading
import time

from PIL import Image


class TooLarge(Exception):
    pass


class Busy(Exception):
    pass


def open_image(field: str, max_pixels: int) -> Image.Image:
    # Image.open only reads the header, so the size is known before any pixel is decoded
    try:
        image = Image.open(io.BytesIO(base64.b64decode(field, validate=True)))
    except Image.DecompressionBombError as error:
        raise TooLarge(str(error)) from error
    width, height = image.size
    if width * height > max_pixels:
        raise TooLarge(f"{width}x{height} px is over the {max_pixels} px limit")
    return image


class Gate:
    """One request computes at a time, `max_queue` more may wait, none past its
    deadline (a time.monotonic() value or None). The slot yields a check that
    raises Busy once the deadline has passed."""

    def __init__(self, max_queue: int) -> None:
        self._max_in_flight = max_queue + 1
        self._in_flight = 0
        self._mutex = threading.Lock()
        self._slot = threading.Lock()

    @contextlib.contextmanager
    def slot(self, deadline):
        def check() -> None:
            if deadline is not None and time.monotonic() > deadline:
                raise Busy("deadline passed")

        with self._mutex:
            if self._in_flight >= self._max_in_flight:
                raise Busy("too many requests waiting")
            self._in_flight += 1
        try:
            check()
            remaining = -1 if deadline is None else min(deadline - time.monotonic(), threading.TIMEOUT_MAX)
            if not self._slot.acquire(timeout=remaining):
                raise Busy("deadline passed")
            try:
                yield check
            finally:
                self._slot.release()
        finally:
            with self._mutex:
                self._in_flight -= 1
