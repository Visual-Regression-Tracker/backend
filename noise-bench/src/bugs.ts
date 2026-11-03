import type { Page } from "@playwright/test";

export type Category =
  | "missing-control"
  | "missing-icon"
  | "overlap"
  | "text-change"
  | "truncation"
  | "colour"
  | "missing-border"
  | "spacing"
  | "duplicate"
  | "wrong-image";

export interface Bug {
  id: string;
  screen: string;
  category: Category;
  severity: "obvious" | "subtle";
  description: string;
  apply: (page: Page) => Promise<void>;
}

/** Adds a stylesheet: the regression a broken CSS change would make. */
const css = (rules: string) => async (page: Page) => {
  await page.addStyleTag({ content: rules });
};

/** Sets inline styles on an element matching `selector`: the first holding `text`, or the `nth`. */
const style =
  (selector: string, styles: Record<string, string>, { text, nth = 0 }: { text?: string; nth?: number } = {}) =>
  async (page: Page) => {
    await page.evaluate(
      ({ selector, styles, text, nth }) => {
        const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(
          (candidate) => text === undefined || candidate.textContent?.trim() === text,
        )[nth];
        if (!element) {
          throw new Error(`No element ${selector}${text ? ` with "${text}"` : ""}`);
        }
        for (const [property, value] of Object.entries(styles)) {
          element.style.setProperty(property, value, "important");
        }
      },
      { selector, styles, text, nth },
    );
  };

type TextEdit = { from: string; to: string } | { bumpDigit: true };

/** Rewrites the first text node under `selector` matching the `match` pattern: a wrong label, a typo, a wrong digit. */
const editText = (selector: string, match: string, edit: TextEdit) => async (page: Page) => {
  await page.evaluate(
    ({ selector, match, edit }) => {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const value = node.textContent ?? "";
          if (!new RegExp(match).test(value)) {
            continue;
          }
          node.textContent =
            "bumpDigit" in edit
              ? value.replace(/\d/, (digit) => String((Number(digit) + 1) % 10))
              : value.replace(edit.from, edit.to);
          return;
        }
      }
      throw new Error(`No text "${match}" under ${selector}`);
    },
    { selector, match, edit },
  );
};

/** Renders an element twice, as a key or state bug would. */
const duplicate = (selector: string, text?: string) => async (page: Page) => {
  await page.evaluate(
    ({ selector, text }) => {
      const element = Array.from(document.querySelectorAll(selector)).find(
        (candidate) => text === undefined || candidate.textContent?.trim() === text,
      );
      if (!element) {
        throw new Error(`No element ${selector}`);
      }
      element.after(element.cloneNode(true));
    },
    { selector, text },
  );
};

/** Swaps the pictures of the first two `img` matching `selector`: a list showing the wrong thumbnail. */
const swapImages = (selector: string) => async (page: Page) => {
  await page.evaluate(async (selector) => {
    const [a, b] = Array.from(document.querySelectorAll<HTMLImageElement>(selector));
    if (!a || !b) {
      throw new Error(`Fewer than two images ${selector}`);
    }
    [a.src, b.src] = [b.src, a.src];
    await Promise.all([a.decode(), b.decode()]);
  }, selector);
};

type KonvaWindow = {
  Konva: {
    stages: {
      container: () => HTMLElement;
      find: (selector: string) => { image: (image?: CanvasImageSource) => CanvasImageSource }[];
      batchDraw: () => void;
    }[];
  };
};

/** The checkpoint pane draws the baseline's picture: the dialog shows the wrong image. */
const checkpointShowsBaseline = async (page: Page) => {
  await page.evaluate(() => {
    const { Konva } = window as unknown as KonvaWindow;
    const [baselinePane, checkpointPane] = Array.from(document.querySelectorAll('[data-testid="drawArea"]'));
    const stageIn = (pane: Element) => Konva.stages.find((stage) => pane.contains(stage.container()))!;
    const baseline = stageIn(baselinePane).find("Image")[0].image();
    const checkpoint = stageIn(checkpointPane);
    checkpoint.find("Image").at(-1)!.image(baseline);
    checkpoint.batchDraw();
  });
};

const ROW = ".MuiDataGrid-row";
const DIALOG = '[role="dialog"]';

export const bugs: Bug[] = [
  // login
  {
    id: "login-no-button",
    screen: "login",
    category: "missing-control",
    severity: "obvious",
    description: "the Login button is not rendered",
    apply: css(`[data-testid="loginBtn"] { visibility: hidden !important; }`),
  },
  {
    id: "login-no-eye-icon",
    screen: "login",
    category: "missing-icon",
    severity: "subtle",
    description: "the show-password eye icon is missing",
    apply: css(`button[aria-label="toggle password visibility"] svg { visibility: hidden !important; }`),
  },
  {
    id: "login-heading-typo",
    screen: "login",
    category: "text-change",
    severity: "subtle",
    description: 'heading reads "Sing in" instead of "Sign in"',
    apply: editText("h1", "Sign in", { from: "Sign in", to: "Sing in" }),
  },
  {
    id: "login-link-colour",
    screen: "login",
    category: "colour",
    severity: "subtle",
    description: '"Create an account" loses its link colour',
    apply: css(`a.MuiLink-root { color: inherit !important; }`),
  },
  {
    id: "login-logo-missing",
    screen: "login",
    category: "wrong-image",
    severity: "obvious",
    description: "the header logo image fails to load (broken image)",
    apply: async (page) => {
      await page.evaluate(() => {
        const logo = document.querySelector<HTMLImageElement>("header img")!;
        logo.src = "/missing-logo.png";
      });
    },
  },
  // login-filled
  {
    id: "login-filled-button-overlap",
    screen: "login-filled",
    category: "overlap",
    severity: "obvious",
    description: "a negative margin pulls the Login button over the password field",
    apply: css(`[data-testid="loginBtn"] { margin-top: -28px !important; }`),
  },
  {
    id: "login-filled-email-clipped",
    screen: "login-filled",
    category: "truncation",
    severity: "subtle",
    description: "the typed e-mail address is clipped by a too narrow input",
    apply: css(`#email { width: 80px !important; flex: none !important; }`),
  },
  {
    id: "login-filled-no-asterisk",
    screen: "login-filled",
    category: "missing-icon",
    severity: "subtle",
    description: "the required-field asterisk on Password is gone",
    apply: css(`#password-label .MuiFormLabel-asterisk { display: none !important; }`),
  },
  // register
  {
    id: "register-no-last-name",
    screen: "register",
    category: "missing-control",
    severity: "obvious",
    description: "the Last name field is not rendered",
    apply: css(`.MuiFormControl-root:has(#lastName) { visibility: hidden !important; }`),
  },
  {
    id: "register-submit-typo",
    screen: "register",
    category: "text-change",
    severity: "subtle",
    description: 'the button reads "Sumbit"',
    apply: editText('[data-testid="submit"]', "Submit", { from: "Submit", to: "Sumbit" }),
  },
  {
    id: "register-button-gap",
    screen: "register",
    category: "spacing",
    severity: "subtle",
    description: "the Submit button sits 8px lower",
    apply: css(`[data-testid="submit"] { margin-top: 8px !important; }`),
  },
  {
    id: "register-subtitle-truncated",
    screen: "register",
    category: "truncation",
    severity: "obvious",
    description: "the subtitle is cut off with an ellipsis",
    apply: css(
      `h1 + p { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; max-width: 280px !important; margin-inline: auto !important; }`,
    ),
  },
  {
    id: "register-heading-duplicated",
    screen: "register",
    category: "duplicate",
    severity: "obvious",
    description: "the heading is rendered twice",
    apply: duplicate("h1"),
  },
  // build-mixed-table
  {
    id: "table-unresolved-green",
    screen: "build-mixed-table",
    category: "colour",
    severity: "obvious",
    description: "an unresolved status chip is drawn in the passed colour",
    apply: style(`${ROW} .MuiChip-root`, { color: "#2e7d32", "border-color": "#2e7d32" }, { text: "unresolved" }),
  },
  {
    id: "table-count-off-by-one",
    screen: "build-mixed-table",
    category: "text-change",
    severity: "subtle",
    description: "the unresolved counter in the build summary is off by one",
    apply: editText("#build-details", "\\d+ unresolved", { bumpDigit: true }),
  },
  {
    id: "table-no-approve-icon",
    screen: "build-mixed-table",
    category: "missing-icon",
    severity: "subtle",
    description: "the (disabled, light) approve icon of the toolbar is missing",
    apply: css(`[data-testid="ThumbUpIcon"] { visibility: hidden !important; }`),
  },
  {
    id: "table-row-dividers",
    screen: "build-mixed-table",
    category: "missing-border",
    severity: "obvious",
    description: "the dividers between rows are gone",
    apply: css(`.MuiDataGrid-root { --DataGrid-rowBorderColor: transparent !important; --rowBorderColor: transparent !important; }`),
  },
  {
    id: "table-row-duplicated",
    screen: "build-mixed-table",
    category: "duplicate",
    severity: "obvious",
    description: "the first test run row is listed twice",
    apply: duplicate(ROW),
  },
  // build-passed
  {
    id: "passed-build-number",
    screen: "build-passed",
    category: "text-change",
    severity: "subtle",
    description: "the build number in the build header is wrong",
    apply: editText("#build-details h6", "#\\d", { bumpDigit: true }),
  },
  {
    id: "passed-viewport-chip-clipped",
    screen: "build-passed",
    category: "truncation",
    severity: "obvious",
    description: "the viewport tag chips are too narrow and end in an ellipsis",
    apply: css(`${ROW} .MuiChip-root:last-child { max-width: 44px !important; }`),
  },
  {
    id: "passed-build-items-overlap",
    screen: "build-passed",
    category: "overlap",
    severity: "obvious",
    description: "the second build item slides up over the first one",
    apply: css(`#build-list .MuiListItemButton-root:nth-of-type(2) { margin-top: -48px !important; }`),
  },
  {
    id: "passed-search-missing",
    screen: "build-passed",
    category: "missing-control",
    severity: "obvious",
    description: "the build search field is not rendered",
    apply: css(`.MuiFormControl-root:has([data-testid="buildSearch"]) { visibility: hidden !important; }`),
  },
  // build-mixed-grid
  {
    id: "grid-thumbnails-swapped",
    screen: "build-mixed-grid",
    category: "wrong-image",
    severity: "obvious",
    description: "the first two cards show each other's thumbnails",
    apply: swapImages('[data-testid="testRunCard"] img'),
  },
  {
    id: "grid-card-name-cut",
    screen: "build-mixed-grid",
    category: "text-change",
    severity: "subtle",
    description: "the first card's name loses its last letter",
    apply: async (page) => {
      await page.evaluate(() => {
        const name = document.querySelector('[data-testid="cardName"]')!;
        name.textContent = name.textContent!.slice(0, -1);
      });
    },
  },
  {
    id: "grid-card-borders",
    screen: "build-mixed-grid",
    category: "missing-border",
    severity: "subtle",
    description: "the cards lose their outline",
    apply: css(`[data-testid="testRunCard"] { border-color: transparent !important; }`),
  },
  {
    id: "grid-show-diff-shifted",
    screen: "build-mixed-grid",
    category: "spacing",
    severity: "subtle",
    description: 'the "Show diff" switch moves 12px to the right',
    apply: css(`label:has([data-testid="showDiffToggle"]) { margin-left: 12px !important; }`),
  },
  {
    id: "grid-checkboxes-missing",
    screen: "build-mixed-grid",
    category: "missing-control",
    severity: "obvious",
    description: "the selection checkboxes on the cards are missing",
    apply: css(`[data-testid="testRunCard"] .MuiCheckbox-root { visibility: hidden !important; }`),
  },
  // build-filtered
  {
    id: "filtered-reset-colour",
    screen: "build-filtered",
    category: "colour",
    severity: "subtle",
    description: "the Reset button text takes the secondary (purple) colour",
    apply: style("#test-run-list button", { color: "#9c27b0", "border-color": "#9c27b0" }, { text: "Reset" }),
  },
  {
    id: "filtered-chip-no-delete-icon",
    screen: "build-filtered",
    category: "missing-icon",
    severity: "subtle",
    description: "the selected status chip lost its remove icon",
    apply: css(`.MuiChip-deleteIcon { visibility: hidden !important; }`),
  },
  {
    id: "filtered-chip-duplicated",
    screen: "build-filtered",
    category: "duplicate",
    severity: "obvious",
    description: 'the "unresolved" filter chip is shown twice',
    apply: duplicate(".MuiAutocomplete-root .MuiChip-root"),
  },
  {
    id: "filtered-pagination-count",
    screen: "build-filtered",
    category: "text-change",
    severity: "subtle",
    description: "the pagination range shows a wrong number",
    apply: editText(".MuiTablePagination-displayedRows", "of", { bumpDigit: true }),
  },
  // details-unresolved
  {
    id: "details-approve-missing",
    screen: "details-unresolved",
    category: "missing-control",
    severity: "obvious",
    description: "the Approve button is not rendered",
    apply: css(`button[aria-label="Hotkey: A"] { visibility: hidden !important; }`),
  },
  {
    id: "details-diff-percent",
    screen: "details-unresolved",
    category: "text-change",
    severity: "subtle",
    description: "the diff percentage shows a wrong digit",
    apply: editText(`${DIALOG} strong`, "\\d", { bumpDigit: true }),
  },
  {
    id: "details-panes-overlap",
    screen: "details-unresolved",
    category: "overlap",
    severity: "obvious",
    description: "the checkpoint pane slides 48px left over the baseline",
    apply: style('[data-testid="drawArea"]', { transform: "translateX(-48px)" }, { nth: 1 }),
  },
  {
    id: "details-close-icon-missing",
    screen: "details-unresolved",
    category: "missing-icon",
    severity: "subtle",
    description: "the dialog's close icon is missing",
    apply: css(`[data-testid="CloseIcon"] { visibility: hidden !important; }`),
  },
  // details-checkpoint
  {
    id: "checkpoint-shows-baseline",
    screen: "details-checkpoint",
    category: "wrong-image",
    severity: "obvious",
    description: "the checkpoint pane draws the baseline image",
    apply: checkpointShowsBaseline,
  },
  {
    id: "checkpoint-label-typo",
    screen: "details-checkpoint",
    category: "text-change",
    severity: "subtle",
    description: 'the pane title reads "Checkpiont"',
    apply: editText(DIALOG, "Checkpoint", { from: "Checkpoint", to: "Checkpiont" }),
  },
  {
    id: "checkpoint-history-colour",
    screen: "details-checkpoint",
    category: "colour",
    severity: "subtle",
    description: "the History link loses its primary colour",
    apply: style(`${DIALOG} button`, { color: "#616161" }, { text: "History" }),
  },
  {
    id: "checkpoint-chips-gap",
    screen: "details-checkpoint",
    category: "spacing",
    severity: "subtle",
    description: "an extra 10px gap before the browser tag chip",
    apply: css(`${DIALOG} [aria-label="Browser"] { margin-left: 10px !important; }`),
  },
  // details-ok
  {
    id: "ok-status-wrong-label",
    screen: "details-ok",
    category: "text-change",
    severity: "subtle",
    description: 'the status chip reads "okay" instead of "ok"',
    apply: editText(`${DIALOG} .MuiChip-label`, "^ok$", { from: "ok", to: "okay" }),
  },
  {
    id: "ok-checkpoint-blank",
    screen: "details-ok",
    category: "wrong-image",
    severity: "obvious",
    description: "the checkpoint pane stays blank",
    apply: style('[data-testid="drawArea"]', { visibility: "hidden" }, { nth: 1 }),
  },
  {
    id: "ok-zoom-out-icon-missing",
    screen: "details-ok",
    category: "missing-icon",
    severity: "subtle",
    description: "the zoom-out icon in the bottom toolbar is missing",
    apply: css(`[data-testid="ZoomOutIcon"] { visibility: hidden !important; }`),
  },
  {
    id: "ok-tag-duplicated",
    screen: "details-ok",
    category: "duplicate",
    severity: "obvious",
    description: "the browser tag chip is rendered twice",
    apply: duplicate(`${DIALOG} [aria-label="Browser"]`),
  },
  // variations
  {
    id: "variations-thumbnails-swapped",
    screen: "variations",
    category: "wrong-image",
    severity: "obvious",
    description: "the first two baselines show each other's pictures",
    apply: swapImages(".MuiCard-root img"),
  },
  {
    id: "variations-count",
    screen: "variations",
    category: "text-change",
    severity: "subtle",
    description: "the baseline counter under the heading is off by one",
    apply: editText("h1 + p", "baselines", { bumpDigit: true }),
  },
  {
    id: "variations-merge-colour",
    screen: "variations",
    category: "colour",
    severity: "obvious",
    description: "the Merge button turns red",
    apply: css(`#select-branch { background-color: #c62828 !important; }`),
  },
  {
    id: "variations-card-outline",
    screen: "variations",
    category: "missing-border",
    severity: "subtle",
    description: "the baseline cards lose their outline",
    apply: css(`.MuiCard-root { border-color: transparent !important; box-shadow: none !important; }`),
  },
  {
    id: "variations-reset-misaligned",
    screen: "variations",
    category: "spacing",
    severity: "subtle",
    description: "the filter Reset button sits 12px lower than the fields",
    apply: style("button", { "margin-top": "12px" }, { text: "Reset" }),
  },
  // variation-details
  {
    id: "vdetails-viewport-clipped",
    screen: "variation-details",
    category: "truncation",
    severity: "subtle",
    description: "the viewport chip is clipped with an ellipsis",
    apply: css(`.MuiChip-root:has(.MuiChip-label) { max-width: 120px !important; }`),
  },
  {
    id: "vdetails-image-overlap",
    screen: "variation-details",
    category: "overlap",
    severity: "obvious",
    description: "the baseline picture is pulled up over its history row",
    apply: css(`img:not(header img) { margin-top: -40px !important; position: relative !important; z-index: 2 !important; }`),
  },
  {
    id: "vdetails-approved-colour",
    screen: "variation-details",
    category: "colour",
    severity: "subtle",
    description: "the approved chip takes the warning colour",
    apply: style(".MuiChip-root", { color: "#ed6c02", "border-color": "#ed6c02" }, { text: "approved" }),
  },
  {
    id: "vdetails-history-count",
    screen: "variation-details",
    category: "text-change",
    severity: "subtle",
    description: "the baseline history counter is off by one",
    apply: editText("h2", "^\\d+$", { bumpDigit: true }),
  },
  // project-settings
  {
    id: "settings-update-missing",
    screen: "project-settings",
    category: "missing-control",
    severity: "obvious",
    description: "the Update button is not rendered",
    apply: css(`[data-testid="submitButton"] { visibility: hidden !important; }`),
  },
  {
    id: "settings-label-typo",
    screen: "project-settings",
    category: "text-change",
    severity: "subtle",
    description: 'the field label reads "Main brach"',
    apply: async (page) => {
      await page.evaluate(() => {
        for (const node of Array.from(document.querySelectorAll("#branchName-label, legend span"))) {
          for (const text of Array.from(node.childNodes)) {
            if (text.nodeType === Node.TEXT_NODE && text.textContent?.includes("Main branch")) {
              text.textContent = text.textContent.replace("Main branch", "Main brach");
            }
          }
        }
      });
    },
  },
  {
    id: "settings-switch-colour",
    screen: "project-settings",
    category: "colour",
    severity: "obvious",
    description: "switched-on toggles use the secondary (purple) colour",
    apply: css(
      `.MuiSwitch-switchBase.Mui-checked { color: #9c27b0 !important; } .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track { background-color: #9c27b0 !important; }`,
    ),
  },
  {
    id: "settings-helper-truncated",
    screen: "project-settings",
    category: "truncation",
    severity: "subtle",
    description: "the threshold helper text is cut off with an ellipsis",
    apply: css(
      `#threshold-helper-text { white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; max-width: 300px !important; }`,
    ),
  },
  // users
  {
    id: "users-role-typo",
    screen: "users",
    category: "text-change",
    severity: "subtle",
    description: 'the role reads "Admln"',
    apply: editText(ROW, "Admin", { from: "Admin", to: "Admln" }),
  },
  {
    id: "users-delete-icon-missing",
    screen: "users",
    category: "missing-icon",
    severity: "subtle",
    description: "the toolbar's delete icon is missing",
    apply: css(`[data-testid="DeleteIcon"] { visibility: hidden !important; }`),
  },
  {
    id: "users-avatar-colour",
    screen: "users",
    category: "wrong-image",
    severity: "obvious",
    description: "the header avatar is drawn with another user's colour",
    apply: css(`header .MuiAvatar-root { background-color: #7b1fa2 !important; }`),
  },
  {
    id: "users-heading-overlap",
    screen: "users",
    category: "overlap",
    severity: "obvious",
    description: "the subtitle is pulled up into the Users heading",
    apply: css(`h1 + p { margin-top: -18px !important; }`),
  },
];

/** "all", a bug set name such as "set2", or a comma-separated list of bug ids. */
export function selectBugs(spec: string): Bug[] {
  if (spec === "all") {
    return bugs;
  }
  const sets = bugSets();
  if (sets[spec]) {
    return sets[spec];
  }
  return spec.split(",").map((id) => {
    const bug = bugs.find((candidate) => candidate.id === id.trim());
    if (!bug) {
      throw new Error(`Unknown bug "${id}"`);
    }
    return bug;
  });
}

/**
 * Splits the catalogue into `count` sets with at most one bug per screen each:
 * the n-th bug of a screen goes to set (screen index + n) mod count.
 */
export function bugSets(count = 5): Record<string, Bug[]> {
  const sets: Bug[][] = Array.from({ length: count }, () => []);
  const screens = [...new Set(bugs.map((bug) => bug.screen))];
  screens.forEach((screen, s) => {
    const own = bugs.filter((bug) => bug.screen === screen);
    if (own.length > count) {
      throw new Error(`Screen ${screen} has ${own.length} bugs, more than the ${count} bug sets`);
    }
    own.forEach((bug, n) => sets[(s + n) % count].push(bug));
  });
  return Object.fromEntries(sets.map((set, i) => [`set${i + 1}`, set]));
}

export function bugsByScreen(selected: Bug[]): Map<string, Bug> {
  const byScreen = new Map<string, Bug>();
  for (const bug of selected) {
    if (byScreen.has(bug.screen)) {
      throw new Error(`Two bugs on screen ${bug.screen} in one build: ${byScreen.get(bug.screen)!.id}, ${bug.id}`);
    }
    byScreen.set(bug.screen, bug);
  }
  return byScreen;
}
