import {
  PIXEL_EVENT_KIND,
  PIXEL_EVENT_RECORD_WORDS,
  PixelEventTape,
} from "./pixel_event_tape.ts";
import { WasmReactiveActiveSimdPixelBlock } from "./pixel_reactive_active_kernel.ts";
import {
  PIXEL_GEL_BONDED_FLAG,
  PIXEL_GEL_BREAK_MOMENTUM,
  PIXEL_GEL_FRACTURED_FLAG,
  PIXEL_GEL_REBOND_TICKS,
} from "./pixel_material.ts";
import {
  MATERIAL,
  packPixel,
  pixelFlags,
  pixelMaterial,
  pixelVariant,
} from "./pixel_sim.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("reactive active SIMD shares one world and flushes bounded events", async () => {
  const width = 8;
  const height = 5;
  const cells = new Uint32Array(width * height).fill(packPixel(MATERIAL.wall));
  cells[2 * width + 3] = packPixel(MATERIAL.fire, 255);
  cells[2 * width + 4] = packPixel(MATERIAL.water, 128);
  const simulation = await WasmReactiveActiveSimdPixelBlock.create(
    cells,
    width,
    height,
    8,
  );
  simulation.enableRegionRevisions();
  const tape = PixelEventTape.create(8);
  const output = new Int32Array(8 * PIXEL_EVENT_RECORD_WORDS);
  const revisionBefore = simulation.regionRevision(0, 0, width - 1, height - 1);

  const result = simulation.step(0);
  simulation.flushEvents(tape);

  assertEquals(result.reactions, 2);
  assertEquals(pixelMaterial(simulation.cells[2 * width + 3]!), MATERIAL.smoke);
  assertEquals(pixelMaterial(simulation.cells[2 * width + 4]!), MATERIAL.gas);
  assertEquals(tape.drainInto(output), 2);
  assertEquals(output[0], PIXEL_EVENT_KIND.extinguished);
  assertEquals(output[1], 2 * width + 3);
  assertEquals(output[PIXEL_EVENT_RECORD_WORDS], PIXEL_EVENT_KIND.vaporized);
  assertEquals(output[PIXEL_EVENT_RECORD_WORDS + 1], 2 * width + 4);
  assertEquals(
    simulation.regionRevision(0, 0, width - 1, height - 1) > revisionBefore,
    true,
  );
});

Deno.test("reactive active SIMD bonds resting gel and fractures high-impact gel", async () => {
  const width = 8;
  const height = 5;
  const cells = new Uint32Array(width * height).fill(packPixel(MATERIAL.wall));
  const resting = 2 * width + 2;
  const impacted = 2 * width + 5;
  cells[resting] = packPixel(MATERIAL.gel, 128, 0, 24);
  cells[impacted] = packPixel(
    MATERIAL.gel,
    128,
    0,
    PIXEL_GEL_BREAK_MOMENTUM,
  );
  const simulation = await WasmReactiveActiveSimdPixelBlock.create(
    cells,
    width,
    height,
  );

  simulation.step(0);

  assertEquals(pixelFlags(simulation.cells[resting]!), PIXEL_GEL_BONDED_FLAG);
  assertEquals(
    pixelFlags(simulation.cells[impacted]!),
    PIXEL_GEL_FRACTURED_FLAG,
  );
  assertEquals(
    pixelVariant(simulation.cells[impacted]!),
    PIXEL_GEL_REBOND_TICKS,
  );

  for (let tick = 1; tick <= PIXEL_GEL_REBOND_TICKS; tick++) {
    simulation.step(tick);
  }

  assertEquals(pixelFlags(simulation.cells[impacted]!), PIXEL_GEL_BONDED_FLAG);
  assertEquals(pixelVariant(simulation.cells[impacted]!), 0);
});
