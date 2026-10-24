# Stage 1: turn the model into one ONNX file. PyTorch is needed only here.
# The file is the same on every architecture, so it is exported once on the
# builder's own platform: an arm64 image built on amd64 CI does not run
# PyTorch under QEMU.
FROM --platform=$BUILDPLATFORM python:3.12-slim AS export
WORKDIR /export
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
 && pip install --no-cache-dir transformers==5.20.2 onnx==1.23.2 onnxruntime==1.31.0 numpy==2.5.4
COPY export_onnx.py .
# pinned: the backend's default threshold was calibrated on this revision
ARG MODEL_ID=facebook/dinov2-base
ARG MODEL_REVISION=f9e44c814b77203eaa57a6bdbbd535f21ede1415
RUN python export_onnx.py "$MODEL_ID" "$MODEL_REVISION" /export/model.onnx

# Stage 2: the service — onnxruntime, numpy, pillow and the model, no PyTorch.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=export /export/model.onnx /model/dinov2-base.onnx
COPY patches.py server.py ./
ENV DINOV2_MODEL_PATH=/model/dinov2-base.onnx \
    DINOV2_MODEL_ID=facebook/dinov2-base \
    PORT=8000 \
    PYTHONUNBUFFERED=1
EXPOSE 8000
USER nobody
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["python", "server.py"]
