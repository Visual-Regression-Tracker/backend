import type { Locator, Page } from "@playwright/test";
import { settings } from "./settings";

type KonvaWindow = {
  Konva?: { stages: { find: (selector: string) => { image: () => HTMLImageElement | null }[] }[] };
};

const FREEZE_CSS = `
*, *::before, *::after {
  transition: none !important;
  animation: none !important;
  caret-color: transparent !important;
}
.MuiTouchRipple-root { display: none !important; }`;

/**
 * Before the page loads: Date.now() and new Date() return one instant, so nothing on screen depends on
 * when the run happens, and no transition is under way when a test clicks something.
 */
export async function freeze(page: Page) {
  await page.clock.setFixedTime(settings.frozenTime);
  await page.addInitScript((css) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
    });
  }, FREEZE_CSS);
}

const settled = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const stages = (window as unknown as KonvaWindow).Konva?.stages ?? [];
    const canvasImages = stages.flatMap((stage) => stage.find("Image").map((node) => node.image()));
    const images = [...Array.from(document.images), ...canvasImages].filter((image) => !!image);
    if (!images.every((image) => image.complete)) {
      return false;
    }
    // complete is not decoded: a picture still decoding is painted at a lower quality first
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    return true;
  });

const nextFrames = (page: Page) =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

/** Waits until the network is quiet, fonts and every image (canvas ones included) are in, and no element keeps focus or hover. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const deadline = Date.now() + 15_000;
  while (!(await settled(page))) {
    if (Date.now() > deadline) {
      throw new Error("Images or fonts did not finish loading");
    }
    await page.waitForTimeout(100);
  }
  await nextFrames(page);
}

export const shoot = (page: Page, target?: Locator): Promise<Buffer> =>
  (target ?? page).screenshot({ animations: "disabled", caret: "hide", scale: "css" });
