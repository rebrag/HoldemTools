import { test as base, expect } from "@playwright/test";

/**
 * Authed specs hit the REAL deployed API with the account's REAL data, so
 * mutations are blocked by construction: any non-GET /api request is aborted
 * and fails the test by name. A spec that legitimately needs to write must
 * import the base test directly and target disposable data on purpose.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const blocked: string[] = [];
    await page.route("**/api/**", (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        blocked.push(`${req.method()} ${req.url()}`);
        return route.abort();
      }
      return route.fallback();
    });
    await use(page);
    expect(blocked, "read-only authed spec attempted a mutating API call").toEqual([]);
  },
});

export { expect };
