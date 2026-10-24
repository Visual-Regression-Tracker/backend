"""Patch-level comparison of two screenshots with DINOv2.

Each screenshot is cut into 224 px tiles at native resolution — no
downscaling, so one 14 px patch of the model is 14 screen pixels and a small
icon still owns a patch of its own — every tile is encoded, and the cosine
distance between the two images' features is taken per patch. The result is a
grid: how much the *content* of each 14x14 patch changed, from 0 (same) up.

Kept free of the model runtime so it can be tested with a stand-in encoder.
"""
from typing import Callable

import numpy as np

PATCH = 14
TILE = 224  # 16 x 16 patches, the size the model was trained at
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)

# (N, 3, TILE, TILE) normalised float32 -> (N, (TILE/PATCH)**2, D) patch features
Encoder = Callable[[np.ndarray], np.ndarray]


def tiles(rgb: np.ndarray) -> tuple[np.ndarray, int, int]:
    """HxWx3 uint8 -> uint8 tiles (N, 3, TILE, TILE), tiles down, across.

    The image is padded with its own edge pixels to whole tiles, so the
    padding looks like the content next to it rather than a blank border.
    Left as uint8: only the tiles encoded are normalised, a few batches at a
    time, rather than a whole tall page as float32.
    """
    h, w, _ = rgb.shape
    rows, cols = -(-h // TILE), -(-w // TILE)
    padded = np.pad(rgb, ((0, rows * TILE - h), (0, cols * TILE - w), (0, 0)), mode="edge")
    x = padded.transpose(2, 0, 1)
    x = x.reshape(3, rows, TILE, cols, TILE).transpose(1, 3, 0, 2, 4).reshape(rows * cols, 3, TILE, TILE)
    return x, rows, cols


def normalize(x: np.ndarray) -> np.ndarray:
    """uint8 tiles -> the normalised float32 the model takes."""
    return (x.astype(np.float32) / 255.0 - MEAN) / STD


def patch_features(rgb: np.ndarray, encode: Encoder, only=None, batch: int = 8) -> np.ndarray:
    """HxWx3 uint8 -> (grid_h, grid_w, D) features covering the image.

    `only`: tile (row, col) pairs to encode; the others stay zero. Tiles are
    encoded independently, so a patch's feature does not depend on which
    other tiles were encoded — skipping them changes nothing but the time.
    """
    h, w, _ = rgb.shape
    x, rows, cols = tiles(rgb)
    wanted = list(range(rows * cols)) if only is None else sorted({r * cols + c for r, c in only if r < rows and c < cols})
    g = TILE // PATCH
    encoded = [encode(normalize(x[wanted[i:i + batch]])) for i in range(0, len(wanted), batch)]
    dim = encoded[0].shape[-1] if encoded else 1
    out = np.zeros((rows * cols, g * g, dim), np.float32)
    if encoded:
        out[wanted] = np.concatenate(encoded)
    grid = out.reshape(rows, cols, g, g, -1).transpose(0, 2, 1, 3, 4).reshape(rows * g, cols * g, -1)
    return grid[: -(-h // PATCH), : -(-w // PATCH)]


def patch_distances(baseline: np.ndarray, image: np.ndarray, encode: Encoder, only=None) -> np.ndarray:
    """Cosine distance per patch between two screenshots of the same size;
    zero for patches in tiles left out of `only`."""
    if baseline.shape != image.shape:
        raise ValueError(f"screenshots differ in size: {baseline.shape[:2]} vs {image.shape[:2]}")
    a = patch_features(baseline, encode, only)
    b = patch_features(image, encode, only)
    dot = (a * b).sum(-1)
    norms = np.linalg.norm(a, axis=-1) * np.linalg.norm(b, axis=-1)
    # both zero where not encoded: no distance rather than a division by zero
    distance = np.where(norms > 0, 1.0 - dot / np.maximum(norms, 1e-12), 0.0)
    return np.clip(distance, 0.0, 2.0).astype(np.float32)
