"""Build step: DINOv2 from Hugging Face -> one ONNX file the service runs.

Checks the exported graph against PyTorch on random tiles before writing,
so a bad export fails the image build rather than every comparison.

Usage: python export_onnx.py <model id> <revision> <out.onnx>
"""
import sys

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoModel

model_id, revision, out = sys.argv[1:4]
model = AutoModel.from_pretrained(model_id, revision=revision).eval()


class Encoder(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, pixel_values):
        return self.inner(pixel_values=pixel_values).last_hidden_state


dummy = torch.randn(2, 3, 224, 224)
torch.onnx.export(
    Encoder(model), (dummy,), out,
    input_names=["pixel_values"], output_names=["last_hidden_state"],
    dynamic_axes={"pixel_values": {0: "batch"}, "last_hidden_state": {0: "batch"}},
    opset_version=17, dynamo=False,
)

check = torch.randn(3, 3, 224, 224, generator=torch.Generator().manual_seed(0))
with torch.no_grad():
    expected = Encoder(model)(check).numpy()
got = ort.InferenceSession(out, providers=["CPUExecutionProvider"]).run(None, {"pixel_values": check.numpy()})[0]
# cosine distance, as the service compares patches; float32 kernels alone differ by ~1e-3 in absolute value
norms = np.linalg.norm(expected, axis=-1) * np.linalg.norm(got, axis=-1)
distance = float((1 - (expected * got).sum(-1) / norms).max())
print(f"exported {model_id}@{revision} -> {out}, output {got.shape}, max patch cosine distance {distance:.2e}")
if not distance <= 1e-5:
    sys.exit("ONNX output does not match PyTorch")
