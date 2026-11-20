import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

export const ACCOUNTS = {
  admin: { email: "admin@logitrack.in", password: "Admin@123", home: "/dashboard" },
  manager: { email: "manager@logitrack.in", password: "Manager@123", home: "/dashboard" },
  dispatcher: { email: "dispatcher@logitrack.in", password: "Dispatch@123", home: "/dashboard" },
  driver: { email: "driver@logitrack.in", password: "Driver@123", home: "/my-deliveries" },
} as const;
export type RoleKey = keyof typeof ACCOUNTS;

/** Signs in through the real login form. */
export async function loginViaUi(page: Page, role: RoleKey) {
  const account = ACCOUNTS[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**${account.home}`);
}

/** Signs in through the API (shares cookies with the page) for tests that are not about the login form. */
export async function loginViaApi(page: Page, role: RoleKey) {
  const account = ACCOUNTS[role];
  const res = await page.request.post("/api/auth/login", { data: { email: account.email, password: account.password } });
  expect(res.status(), `login as ${role}`).toBe(200);
}

/** Unwraps the `{ data }` envelope of a successful API response. */
export async function apiGet<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  return (await res.json()).data as T;
}

export async function apiSend<T>(request: APIRequestContext, method: "post" | "put" | "delete", url: string, data?: unknown): Promise<T> {
  const res = await request[method](url, { data: data ?? {} });
  expect(res.status(), `${method.toUpperCase()} ${url}: ${await res.text()}`).toBe(200);
  return (await res.json()).data as T;
}

/** Picks the option of a <select> whose text contains `text`. */
export async function selectContaining(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  expect(value, `option containing "${text}"`).toBeTruthy();
  await select.selectOption(value!);
}

/** Opens the "…" menu of the table row containing `rowText` and clicks an item. */
export async function rowAction(page: Page, rowText: string, action: string) {
  const row = page.getByRole("row").filter({ hasText: rowText }).first();
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

export const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text }).first();

/** A registration number that is unique per run, in valid Indian format. */
export function uniqueRegistration(): string {
  const n = String(Date.now() % 10_000).padStart(4, "0");
  const letters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return `MH 12 ${letters} ${n}`;
}

export const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
