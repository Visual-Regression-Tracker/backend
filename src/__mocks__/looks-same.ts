// Mock for looks-same to avoid ESM @jsquash/png issues in Jest
// Provides a simple comparison implementation for tests
async function looksSame(
  img1: Buffer | { source: Buffer },
  img2: Buffer | { source: Buffer },
  options?: any
): Promise<{ equal: boolean }> {
  const buf1 = Buffer.isBuffer(img1) ? img1 : img1.source;
  const buf2 = Buffer.isBuffer(img2) ? img2 : img2.source;
  
  // Simple buffer comparison
  if (buf1.length !== buf2.length) {
    return { equal: false };
  }
  
  const tolerance = options?.tolerance ?? 2.5;
  let diffPixels = 0;
  const totalPixels = buf1.length / 4;
  
  for (let i = 0; i < buf1.length; i += 4) {
    const r1 = buf1[i];
    const g1 = buf1[i + 1];
    const b1 = buf1[i + 2];
    
    const r2 = buf2[i];
    const g2 = buf2[i + 1];
    const b2 = buf2[i + 2];
    
    const delta = Math.sqrt(
      Math.pow(r1 - r2, 2) +
      Math.pow(g1 - g2, 2) +
      Math.pow(b1 - b2, 2)
    ) / 255 * 100;
    
    if (delta > tolerance) {
      diffPixels++;
    }
  }
  
  const diffPercent = (diffPixels / totalPixels) * 100;
  const equal = diffPercent === 0;
  
  return { equal };
}

looksSame.createDiff = async function createDiff(options: any): Promise<void> {
  // Simple diff creation - just copy reference to current
  // For testing purposes, this is a no-op
  return Promise.resolve();
};

export default looksSame;

