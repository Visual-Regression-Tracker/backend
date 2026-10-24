# DINOv2 service

A second look for the rendering-noise filter. When an image-comparison config
has `blurAmplitudeFilter` and `dinov2Check` on, a failing comparison the blur
would pass as anti-aliasing is sent here first: DINOv2 compares the two
screenshots' *content* patch by patch, which catches what is faint in pixels
but clear in meaning — a missing light icon, a removed input border.

The service only measures. The backend (`src/compare/libs/dinov2`) decides:
it marks the patches where pixelmatch sees a non-anti-aliasing change, asks
for the distances of the tiles holding them, and fails the run when two
neighbouring marked patches changed by more than `dinov2Threshold`
(default 0.15, calibrated in `research/jepa-screenshot-diff`). If the service
cannot be reached, the run goes to review: the check never lets a change
through it could not look at.

## Run

```bash
docker compose --profile dinov2 up -d dinov2   # then DINOV2_URL=http://dinov2:8000 for the api
```

The image exports `facebook/dinov2-base` (pinned revision) to ONNX at build
time; at runtime it needs only onnxruntime, numpy and pillow (~350 MB model,
CPU). Only the 224 px tiles holding a change are encoded (about 9 of a
1280x720 page's 24, measured), at ~0.3–0.5 s per tile with the default
`DINOV2_THREADS=4` — onnxruntime's own default of one thread per core ran up to
7x slower in a container. It runs only for runs the blur would pass.

## API

`POST /v1/patch-distances` — `{"baseline": "<base64 PNG>", "image": "<base64 PNG>", "tiles": [[row, col], …]}`
→ `{"patch": 14, "width": …, "height": …, "distances": […]}` (row-major cosine
distances per 14 px patch; `tiles` optional, default all). `GET /health`.

## Test

```bash
python -m unittest test_patches   # numpy only, no model
```
