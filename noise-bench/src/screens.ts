import { expect, type Locator, type Page } from "@playwright/test";
import type { ShowcaseIds } from "./showcase";

export interface Screen {
  id: string;
  description: string;
  /** Showcase ids the screen opens; it is skipped when the Showcase project lacks one. */
  needs: (keyof ShowcaseIds)[];
  open: (page: Page, ids: ShowcaseIds) => Promise<void>;
  /** The element to capture instead of the viewport. */
  target?: (page: Page) => Locator;
}

const signedOut = (page: Page) => page.addInitScript(() => window.localStorage.removeItem("user"));

const rows = (page: Page) => page.locator(".MuiDataGrid-row");
const dialog = (page: Page) => page.getByRole("dialog");
const drawAreas = (page: Page) => page.getByTestId("drawArea");

async function openProject(page: Page, projectId: string, buildId: string, testId?: string) {
  await page.goto(`/${projectId}?buildId=${buildId}${testId ? `&testId=${testId}` : ""}`);
  await expect(page.locator("#build-list")).toBeVisible();
}

async function openDetails(page: Page, ids: ShowcaseIds, testId: string) {
  await openProject(page, ids.projectId, ids.mixedBuildId!, testId);
  await expect(page.getByRole("heading", { name: /^Step \d+\/\d+:/ })).toBeVisible();
  await expect(drawAreas(page)).toHaveCount(2);
}

export const screens: Screen[] = [
  {
    id: "login",
    description: "sign-in form",
    needs: [],
    open: async (page) => {
      await signedOut(page);
      await page.goto("/login");
      await expect(page.getByTestId("loginBtn")).toBeVisible();
    },
  },
  {
    id: "login-filled",
    description: "sign-in form with an address and a masked password typed in",
    needs: [],
    open: async (page) => {
      await signedOut(page);
      await page.goto("/login");
      await page.getByTestId("email").fill("reviewer@example.com");
      await page.getByTestId("password").fill("placeholder");
      await expect(page.getByTestId("loginBtn")).toBeEnabled();
    },
  },
  {
    id: "register",
    description: "account registration form",
    needs: [],
    open: async (page) => {
      await signedOut(page);
      await page.goto("/register");
      await expect(page.getByTestId("submit")).toBeVisible();
    },
  },
  {
    id: "build-mixed-table",
    description: "Showcase project page: build list and the runs of a build with mixed statuses, as a table",
    needs: ["mixedBuildId"],
    open: async (page, ids) => {
      await openProject(page, ids.projectId, ids.mixedBuildId!);
      await expect(rows(page).first()).toBeVisible();
    },
  },
  {
    id: "build-mixed-grid",
    description: "the same build as a grid of cards with thumbnails",
    needs: ["mixedBuildId"],
    open: async (page, ids) => {
      await openProject(page, ids.projectId, ids.mixedBuildId!);
      await page.getByTestId("gridViewToggle").click();
      await expect(page.getByTestId("testRunCard").first()).toBeVisible();
    },
  },
  {
    id: "build-passed",
    description: "a build where every run passed",
    needs: ["passedBuildId"],
    open: async (page, ids) => {
      await openProject(page, ids.projectId, ids.passedBuildId!);
      await expect(rows(page).first()).toBeVisible();
    },
  },
  {
    id: "build-filtered",
    description: "the mixed build filtered to unresolved runs",
    needs: ["mixedBuildId"],
    open: async (page, ids) => {
      await openProject(page, ids.projectId, ids.mixedBuildId!);
      await expect(rows(page).first()).toBeVisible();
      await page.getByRole("combobox", { name: "Status" }).click();
      await page.getByRole("option", { name: "unresolved" }).click();
      await page.keyboard.press("Escape");
      await expect(rows(page).first()).toBeVisible();
    },
  },
  {
    id: "details-unresolved",
    description: "test run dialog: baseline next to the checkpoint with the diff on top",
    needs: ["mixedBuildId", "unresolvedRunId"],
    open: (page, ids) => openDetails(page, ids, ids.unresolvedRunId!),
  },
  {
    id: "details-checkpoint",
    description: "the same dialog with the diff switched off",
    needs: ["mixedBuildId", "unresolvedRunId"],
    open: async (page, ids) => {
      await openDetails(page, ids, ids.unresolvedRunId!);
      const toggle = page.getByRole("switch", { name: "Toggle diff" });
      await toggle.click();
      await expect(toggle).not.toBeChecked();
    },
  },
  {
    id: "details-ok",
    description: "test run dialog of a run that matched its baseline",
    needs: ["mixedBuildId", "okRunId"],
    open: (page, ids) => openDetails(page, ids, ids.okRunId!),
  },
  {
    id: "variations",
    description: "baselines of the Showcase project",
    needs: [],
    open: async (page, ids) => {
      // the API lists variations without an ORDER BY, so card order follows Postgres row order
      await page.route((url) => url.pathname.endsWith("/test-variations"), async (route) => {
        const variations: { name: string }[] = await (await route.fetch()).json();
        await route.fulfill({ json: variations.sort((a, b) => a.name.localeCompare(b.name)) });
      });
      await page.goto(`/variations/${ids.projectId}`);
      await expect(page.locator(".MuiCard-root").first()).toBeVisible();
    },
  },
  {
    id: "variation-details",
    description: "history of one baseline",
    needs: ["variationId"],
    open: async (page, ids) => {
      await page.goto(`/variations/details/${ids.variationId}`);
      await expect(page.locator("img").first()).toBeVisible();
    },
  },
  {
    id: "project-settings",
    description: "the Showcase project's settings form",
    needs: [],
    open: async (page, ids) => {
      await page.goto("/projects");
      const card = page.locator(".MuiCard-root").filter({ has: page.getByRole("heading", { name: ids.name, exact: true }) });
      await card.getByTestId("EditIcon").click();
      await expect(dialog(page).locator("#name")).toHaveValue(ids.name);
    },
    target: (page) => dialog(page),
  },
  {
    id: "users",
    description: "user administration list",
    needs: [],
    open: async (page) => {
      await page.goto("/users");
      await expect(rows(page).first()).toBeVisible();
    },
  },
];
