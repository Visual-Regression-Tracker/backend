# DINOv2 service

The second stage of the rendering-noise check. When a project has the DINOv2 stage on and
`DINOV2_URL` is set, a run that the blur stage called noise is sent here for a second look:
DINOv2 compares the two screenshots' _content_ patch by patch, which catches what is faint in
pixels but clear in meaning — a missing light icon, a removed input border.

The service only measures. The backend (`src/compare/libs/dinov2`) takes the patches the blur
stage marked, asks for the distances of the tiles holding them, and labels the run "likely change"
when the strongest marked patch is above the project's `distanceThreshold` (0.15 by default,
checked against the noise pairs of `test_noise`). Otherwise the run stays "likely noise". Nothing
fails a run, and no status changes. If the service cannot be reached, the hint falls back to the
blur stage's verdict and says so.

## Run

```bash
docker compose --profile dinov2 up -d dinov2   # then DINOV2_URL=http://dinov2:8000 for the api
```

The image exports `facebook/dinov2-base` (pinned revision) to ONNX at build
time; at runtime it needs only onnxruntime, numpy and pillow (~350 MB model,
CPU). Only the 224 px tiles holding a change are encoded (about 9 of a
1280x720 page's 24, measured), at ~0.3–0.5 s per tile with the default
`DINOV2_THREADS=4` — onnxruntime's own default of one thread per core ran up to
7x slower in a container. It runs only for runs the blur stage called noise.

## API

`POST /v1/patch-distances` — `{"baseline": "<base64 PNG>", "image": "<base64 PNG>", "tiles": [[row, col], …]}`
→ `{"patch": 14, "width": …, "height": …, "distances": […]}` (row-major cosine
distances per 14 px patch; `tiles` optional, default all). `GET /health`.

## Test

```bash
python -m unittest test_patches test_guard   # no model
```
