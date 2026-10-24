import { expect, test, type Page } from "@playwright/test";

const SLUG = process.env.E2E_BUSINESS_SLUG ?? "barberhood";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function pickService(page: Page, name: RegExp) {
  await page.goto(`/${SLUG}/prenota`);
  await expect(page.getByRole("heading", { name: "Scegli il servizio" })).toBeVisible();
  await page.getByRole("button", { name }).first().click();
}

/** Picks the first day with free slots and its first time. Returns the time label. */
async function pickFirstSlot(page: Page) {
  await expect(page.getByRole("heading", { name: "Scegli giorno e ora" })).toBeVisible();
  const slot = page.locator("fieldset button[aria-pressed]").first();
  await expect(slot).toBeVisible({ timeout: 15_000 });
  const label = (await slot.textContent())!.trim();
  await slot.click();
  return label;
}

async function fillDetails(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "I tuoi dati" })).toBeVisible();
  await page.getByLabel("Nome e cognome").fill("Mario Rossi E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/Telefono/).fill("+39 333 1234567");
  await page.getByRole("checkbox").check();
  await page.waitForTimeout(3_000); // the anti-spam check refuses forms filled in under a few seconds
  await page.getByRole("button", { name: "Continua" }).click();
}

test("a customer books online, then cancels from the manage link", async ({ page }) => {
  const email = unique();
  await pickService(page, /Taglio uomo\s/);
  await expect(page.getByRole("heading", { name: /Scegli il barbiere/i })).toBeVisible();
  await page.getByRole("button", { name: /Primo disponibile/ }).click();
  const time = await pickFirstSlot(page);
  await fillDetails(page, email);

  await expect(page.getByRole("heading", { name: "Controlla e conferma" })).toBeVisible();
  await expect(page.getByText(time).first()).toBeVisible();
  await page.getByRole("button", { name: "Conferma prenotazione" }).click();

  await expect(page.getByRole("heading", { name: "Prenotato." })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`ore ${time}`)).toBeVisible();

  await page.getByRole("link", { name: "Sposta o annulla" }).click();
  await expect(page).toHaveURL(/\/gestisci\//);
  await expect(page.getByText(`ore ${time}`).first()).toBeVisible();
  await page.getByRole("button", { name: /Annulla appuntamento/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Annulla appuntamento|Sì, annulla/ }).click();
  await expect(page.getByText(/annullato/i).first()).toBeVisible({ timeout: 15_000 });
});

test("going back keeps the choices and the typed details", async ({ page }) => {
  await pickService(page, /Barba sagomata\s/);
  await page.getByRole("button", { name: /Primo disponibile/ }).click();
  await pickFirstSlot(page);
  await page.getByLabel("Nome e cognome").fill("Bozza Persistente");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Scegli giorno e ora" })).toBeVisible();
  await expect(page.locator('fieldset button[aria-pressed="true"]')).toHaveCount(1);
  await page.goForward();
  await expect(page.getByLabel("Nome e cognome")).toHaveValue("Bozza Persistente");
  // After a reload the time must be picked again (availability may have changed), typed details survive
  await page.reload();
  await pickFirstSlot(page);
  await expect(page.getByLabel("Nome e cognome")).toHaveValue("Bozza Persistente");
});

test("the same slot cannot be booked twice (server re-checks)", async ({ request }) => {
  const svc = await serviceId(request);
  const res = await request.get(`/api/public/${SLUG}/availability?serviceId=${svc}&staffId=any&from=${today()}&days=14`);
  expect(res.ok()).toBeTruthy();
  const { days } = (await res.json()) as { days: { slots: { start: string; staffIds: string[] }[] }[] };
  const slot = days.find((d) => d.slots.length > 0)!.slots.at(-1)!;
  const book = (email: string) =>
    request.post(`/api/public/${SLUG}/bookings`, {
      data: { serviceId: svc, staffId: slot.staffIds[0], startsAt: slot.start, name: "Doppio Test", email, phone: "+39 333 7654321", acceptPrivacy: true, formStartedAt: Date.now() - 10_000 },
    });
  const first = await book(unique());
  expect(first.status()).toBe(201);
  const second = await book(unique());
  expect(second.status()).toBe(409);
  expect((await second.json()).error.code).toBe("slot_taken");
});

test("invalid input is refused with a readable error", async ({ request }) => {
  const res = await request.post(`/api/public/${SLUG}/bookings`, { data: { serviceId: "nope", email: "x" } });
  expect(res.status()).toBe(400);
  const json = await res.json();
  expect(json.error.message).toBeTruthy();
  expect(JSON.stringify(json)).not.toMatch(/stack|postgres|supabase/i);
});

test("admin pages require login", async ({ page }) => {
  await page.goto("/admin/calendario");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test.describe("admin", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD");

  test("the owner logs in, sees the dashboard and creates a phone booking", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(ADMIN_EMAIL!);
    await page.getByLabel("Password").fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "Entra" }).click();
    await expect(page.getByRole("heading", { name: /^Oggi/ })).toBeVisible({ timeout: 15_000 });

    // Same entry point as a click on a calendar cell
    await page.goto(`/admin/appuntamenti/nuovo?data=${nextWorkingDay()}`);
    await expect(page.getByLabel("Data")).toHaveValue(nextWorkingDay());
    const slot = page.getByRole("radiogroup", { name: "Orari disponibili" }).getByRole("radio").first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.click();
    await page.getByLabel("Nome", { exact: true }).fill("Cliente Telefono E2E");
    await page.getByRole("button", { name: "Crea appuntamento" }).click();
    await expect(page).toHaveURL(/\/admin\/appuntamenti\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByText("Cliente Telefono E2E")).toBeVisible();
    await expect(page.getByText(/Creato dal negozio/)).toBeVisible();

    // Cancel it so the test leaves the agenda as it found it
    await page.getByRole("button", { name: "Annulla appuntamento" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Annulla appuntamento" }).click();
    await expect(page.getByText(/Annullato dal negozio/).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
async function serviceId(request: import("@playwright/test").APIRequestContext): Promise<string> {
  if (process.env.E2E_SERVICE_ID) return process.env.E2E_SERVICE_ID;
  const html = await (await request.get(`/${SLUG}/prenota`)).text();
  const m = html.match(/"id":"([0-9a-f-]{36})","name":"Taglio uomo"/) ?? html.match(/\\"id\\":\\"([0-9a-f-]{36})\\",\\"name\\":\\"Taglio uomo\\"/);
  if (!m) throw new Error("Service id not found: set E2E_SERVICE_ID");
  return m[1]!;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

/** Next Tuesday–Saturday at least 2 days ahead (the pilot shop's working days). */
function nextWorkingDay() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  while ([0, 1].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
