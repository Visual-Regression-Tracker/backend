import { PNG } from 'pngjs';
import { DINOV2_PATCH, gateOfDecoded } from './patch-gate.core';
import { applyIgnoreAreas } from '../../utils';
import { IgnoreAreaDto } from '../../../test-runs/dto/ignore-area.dto';
import { paintedPng, pngBytes, solidPng, square } from '../../test-utils';

const WIDTH = 60;
const HEIGHT = 40;

const blank = pngBytes(solidPng(WIDTH, HEIGHT));
const block = pngBytes(paintedPng(WIDTH, HEIGHT, square(30, 16, 10, [200, 40, 40])));

const gateOf = (baseline: Buffer, image: Buffer, ignoreAreas: IgnoreAreaDto[] = []) => {
  const decodedBaseline = PNG.sync.read(baseline);
  const decodedImage = PNG.sync.read(image);
  applyIgnoreAreas(decodedBaseline, ignoreAreas);
  applyIgnoreAreas(decodedImage, ignoreAreas);
  return gateOfDecoded(decodedBaseline, decodedImage, DINOV2_PATCH);
};

describe('gateOfDecoded', () => {
  it('marks the patches where pixelmatch sees a change', () => {
    expect(gateOf(blank, block)).toEqual({ width: 5, height: 3, cells: [1 * 5 + 2] });
  });

  it('marks nothing for identical screenshots', () => {
    expect(gateOf(blank, blank)).toEqual({ width: 5, height: 3, cells: [] });
  });

  it('leaves out what the ignore areas cover', () => {
    expect(gateOf(blank, block, [{ x: 28, y: 14, width: 14, height: 14 }]).cells).toEqual([]);
  });

  it('gives a gate that survives a structured clone', () => {
    const gate = gateOf(blank, block);

    expect(structuredClone(gate)).toEqual(gate);
  });

  it('uses the 14 px patch of DINOv2', () => {
    expect(DINOV2_PATCH).toBe(14);
  });
});
