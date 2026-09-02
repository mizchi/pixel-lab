import { FakeDocument } from "../src/test_dom.ts";
import { SimdUi, type UiContainer, type UiDocument } from "./dom.ts";

Deno.test("demo DOM binding updates text when a signal changes", async () => {
  const document = new FakeDocument();
  const ui = new SimdUi({ document: document as unknown as UiDocument });
  const count = ui.signal(1);
  const root = ui.element("strong", {}, [
    ui.text([count], () => `tick ${count.value}`),
  ]);
  const host = document.createElement("main");

  await ui.mount(host as unknown as UiContainer, root);
  assertEquals(host.textContent, "tick 1");

  count.value = 2;
  assertEquals(host.textContent, "tick 2");
});

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`expected ${expected}, got ${actual}`);
  }
}
