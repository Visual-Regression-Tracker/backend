// Mock for pixelmatch to avoid ESM issues in Jest
// Provides a simple pixel-by-pixel comparison for tests
function pixelmatch(
  img1: Buffer | Uint8Array | Uint8ClampedArray,
  img2: Buffer | Uint8Array | Uint8ClampedArray,
  output: Buffer | Uint8Array | Uint8ClampedArray | null,
  width: number,
  height: number,
  options?: any
): number {
  const threshold = options?.threshold ?? 0.1;
  let diff = 0;
  
  // Simple pixel comparison
  for (let i = 0; i < img1.length; i += 4) {
    const r1 = img1[i];
    const g1 = img1[i + 1];
    const b1 = img1[i + 2];
    const a1 = img1[i + 3];
    
    const r2 = img2[i];
    const g2 = img2[i + 1];
    const b2 = img2[i + 2];
    const a2 = img2[i + 3];
    
    // Calculate color difference
    const delta = Math.sqrt(
      Math.pow(r1 - r2, 2) +
      Math.pow(g1 - g2, 2) +
      Math.pow(b1 - b2, 2) +
      Math.pow(a1 - a2, 2)
    ) / 255;
    
    if (delta > threshold) {
      diff++;
      // Mark different pixels in output if provided
      if (output) {
        output[i] = 255;     // R
        output[i + 1] = 0;   // G
        output[i + 2] = 0;   // B
        output[i + 3] = 255; // A
      }
    } else if (output) {
      // Copy original pixel to output
      output[i] = img1[i];
      output[i + 1] = img1[i + 1];
      output[i + 2] = img1[i + 2];
      output[i + 3] = img1[i + 3];
    }
  }
  
  return diff;
}

export default pixelmatch;

