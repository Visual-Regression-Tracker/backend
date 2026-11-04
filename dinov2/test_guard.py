"""python -m unittest test_guard — no model needed."""
import base64
import io
import threading
import time
import unittest

from PIL import Image

from guard import Busy, Gate, TooLarge, open_image


def png_field(width: int, height: int) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (245, 245, 245)).save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode()


class DecodeTest(unittest.TestCase):
    def test_decodes_a_png_within_the_cap(self):
        self.assertEqual(open_image(png_field(20, 10), 200).size, (20, 10))

    def test_refuses_a_png_over_the_cap_from_its_header(self):
        with self.assertRaises(TooLarge):
            open_image(png_field(20, 11), 200)

    def test_refuses_a_decompression_bomb(self):
        old = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = 100
        try:
            with self.assertRaises(TooLarge):
                open_image(png_field(100, 100), 10**9)
        finally:
            Image.MAX_IMAGE_PIXELS = old

    def test_rejects_bytes_that_are_not_an_image(self):
        with self.assertRaises(OSError):
            open_image(base64.b64encode(b"not a png").decode(), 200)


class GateTest(unittest.TestCase):
    def test_runs_when_free(self):
        with Gate(max_queue=1).slot(time.monotonic() + 1):
            pass

    def test_accepts_a_deadline_beyond_what_a_lock_can_wait(self):
        with Gate(max_queue=1).slot(time.monotonic() + 10**12):
            pass

    def test_refuses_at_once_when_the_deadline_has_passed(self):
        with self.assertRaises(Busy):
            with Gate(max_queue=1).slot(time.monotonic() - 1):
                self.fail("ran")

    def test_refuses_when_the_deadline_passes_while_waiting(self):
        gate = Gate(max_queue=1)
        with gate.slot(None):
            started = time.monotonic()
            with self.assertRaises(Busy):
                with gate.slot(started + 0.05):
                    self.fail("ran")
            self.assertLess(time.monotonic() - started, 1)

    def test_refuses_past_the_queue_bound_without_waiting(self):
        gate = Gate(max_queue=1)
        entered, release = threading.Event(), threading.Event()

        def hold():
            with gate.slot(None):
                entered.set()
                release.wait(5)

        def wait():
            with gate.slot(None):
                pass

        runner = threading.Thread(target=hold)
        runner.start()
        entered.wait(5)
        waiter = threading.Thread(target=wait)
        waiter.start()
        time.sleep(0.05)
        started = time.monotonic()
        with self.assertRaises(Busy):
            with gate.slot(None):
                self.fail("ran")
        self.assertLess(time.monotonic() - started, 0.5)
        release.set()
        runner.join()
        waiter.join()

    def test_check_raises_once_the_deadline_has_passed_while_running(self):
        with Gate(max_queue=1).slot(time.monotonic() + 0.05) as check:
            check()
            time.sleep(0.08)
            with self.assertRaises(Busy):
                check()

    def test_check_never_raises_without_a_deadline(self):
        with Gate(max_queue=1).slot(None) as check:
            check()

    def test_frees_the_place_after_a_refusal_and_after_use(self):
        gate = Gate(max_queue=0)
        for _ in range(3):
            with gate.slot(None):
                pass
        with gate.slot(None):
            with self.assertRaises(Busy):
                with gate.slot(None):
                    pass
        with gate.slot(None):
            pass


if __name__ == "__main__":
    unittest.main()
