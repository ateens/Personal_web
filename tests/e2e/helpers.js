import { expect } from "@playwright/test";
import { FIXTURE_IDS } from "../fixtures/state.mjs";

export { FIXTURE_IDS };

export async function resetFixture(request) {
  const response = await request.post("/__e2e__/reset", {
    headers: { "x-e2e-reset-token": "sygma-local-e2e-reset" },
  });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["x-e2e-production-write-guard"]).toBe("active");
}

export async function fixtureSnapshot(request) {
  const response = await request.get("/__e2e__/state");
  expect(response.ok()).toBeTruthy();
  return response.json();
}
