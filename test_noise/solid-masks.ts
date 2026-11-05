import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { SOLID_PARAMS, solidMask } from '../src/compare/libs/pixelmatch/blur-amplitude.core';
import { RawImage } from '../src/compare/utils';

const USAGE =
  'Usage: npx ts-node test_noise/solid-masks.ts <pairsDir> <outDir>  (pairs: <name>-base.png + <name>-image.png)';

const decode = (file: string): RawImage => {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { data: png.data, width: png.width, height: png.height };
};

function main(): void {
  const [pairsDir, outDir] = process.argv.slice(2);
  if (!pairsDir || !outDir) {
    console.error(USAGE);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const names = fs
    .readdirSync(pairsDir)
    .filter((f) => f.endsWith('-base.png'))
    .map((f) => f.slice(0, -'-base.png'.length))
    .filter((name) => fs.existsSync(path.join(pairsDir, `${name}-image.png`)))
    .sort();

  for (const name of names) {
    const baseline = decode(path.join(pairsDir, `${name}-base.png`));
    const image = decode(path.join(pairsDir, `${name}-image.png`));
    const result = solidMask(baseline, image);
    if (!result) {
      throw new Error(`${name}: changed area too large to measure`);
    }
    const { width, height } = baseline;
    const mask = new Uint8Array(Math.ceil((width * height) / 8));
    result.mask.forEach((solid, i) => {
      if (solid) mask[i >> 3] |= 1 << (i & 7);
    });
    fs.writeFileSync(path.join(outDir, `${name}.mask.bin`), mask);
    fs.writeFileSync(
      path.join(outDir, `${name}.mask.json`),
      JSON.stringify(
        {
          width,
          height,
          solidPixels: result.measure.solidPixels,
          encoding: 'bit-packed row-major, LSB first, bit i = pixel y*width+x',
          SOLID_MIN_CHANGE: SOLID_PARAMS.minChange,
          SOLID_KEEP: SOLID_PARAMS.keep,
        },
        null,
        2
      ) + '\n'
    );
    console.log(`${name}: ${width}x${height}, solid ${result.measure.solidPixels}`);
  }
}

main();
