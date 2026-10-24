"""python -m unittest test_patches — no model needed: a stand-in encoder whose
feature for a patch is its mean colour (plus a constant, so a blank patch is
not a zero vector)."""
import unittest

import numpy as np

from patches import PATCH, TILE, patch_distances, patch_features, tiles


def mean_colour_encoder(x: np.ndarray) -> np.ndarray:
    n = x.shape[0]
    g = TILE // PATCH
    cells = x.reshape(n, 3, g, PATCH, g, PATCH).mean(axis=(3, 5))  # n, 3, g, g
    features = cells.transpose(0, 2, 3, 1).reshape(n, g * g, 3)
    return np.concatenate([features, np.full((n, g * g, 1), 3.0, np.float32)], -1)


def page(h=300, w=500):
    return np.full((h, w, 3), 245, np.uint8)


class TilesTest(unittest.TestCase):
    def test_pads_to_whole_tiles_with_edge_pixels(self):
        x, rows, cols = tiles(page(300, 500))
        self.assertEqual((rows, cols), (2, 3))
        self.assertEqual(x.shape, (6, 3, TILE, TILE))
        # the padding repeats the page, so every tile normalises the same
        self.assertTrue(np.allclose(x, x[0]))


class PatchFeaturesTest(unittest.TestCase):
    def test_covers_the_image_one_feature_per_patch(self):
        grid = patch_features(page(300, 500), mean_colour_encoder)
        self.assertEqual(grid.shape[:2], (-(-300 // PATCH), -(-500 // PATCH)))

    def test_keeps_patches_in_place(self):
        img = page()
        img[230:240, 300:310] = 0  # a dark mark in the second tile row
        grid = patch_features(img, mean_colour_encoder)
        darkest = np.unravel_index(np.argmin(grid[..., 0]), grid.shape[:2])
        self.assertEqual(darkest, (230 // PATCH, 300 // PATCH))


class PatchDistancesTest(unittest.TestCase):
    def test_identical_screens_do_not_differ(self):
        self.assertAlmostEqual(float(patch_distances(page(), page(), mean_colour_encoder).max()), 0.0, places=5)

    def test_a_change_shows_where_it_is(self):
        changed = page()
        changed[14:28, 28:42] = (200, 40, 40)
        distances = patch_distances(page(), changed, mean_colour_encoder)
        self.assertEqual(np.unravel_index(np.argmax(distances), distances.shape), (1, 2))
        self.assertGreater(distances.max(), 0.01)
        self.assertEqual(int((distances > 1e-6).sum()), 1)

    # tiles are independent: encoding only some changes no distance inside them
    def test_encodes_only_the_tiles_asked_for(self):
        changed = page()
        changed[14:28, 28:42] = (200, 40, 40)
        calls = []

        def counting(x):
            calls.append(len(x))
            return mean_colour_encoder(x)

        distances = patch_distances(page(), changed, counting, only=[(0, 0)])
        full = patch_distances(page(), changed, mean_colour_encoder)
        self.assertEqual(sum(calls), 2)  # one tile from each screenshot
        self.assertTrue(np.array_equal(distances[:16, :16], full[:16, :16]))
        self.assertEqual(float(distances[16:, :].max(initial=0)), 0.0)

    def test_no_tiles_asked_for_gives_no_distance(self):
        self.assertEqual(float(patch_distances(page(), page(), mean_colour_encoder, only=[]).max()), 0.0)

    def test_refuses_screens_of_different_sizes(self):
        with self.assertRaises(ValueError):
            patch_distances(page(300, 500), page(310, 500), mean_colour_encoder)


if __name__ == "__main__":
    unittest.main()
