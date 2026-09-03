import { WasmActiveSimdPixelBlock } from "./pixel_block_active_kernel.ts";
import { WasmSimdPixelBlock } from "./pixel_block_kernel.ts";
import { PIXEL_GEL_BONDED_FLAG } from "./pixel_material.ts";
import {
  countPixelMaterials,
  MATERIAL,
  packPixel,
  paintPixelCircle,
} from "./pixel_sim.ts";

function assertEquals(
  actual: unknown,
  expected: unknown,
  message = "values differ",
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("active SIMD blocks exactly match full SIMD across chunk boundaries", async () => {
  const width = 131;
  const height = 99;
  const initial = new Uint32Array(width * height);
  for (let x = 0; x < width; x++) {
    initial[x] = packPixel(MATERIAL.wall);
    initial[(height - 1) * width + x] = packPixel(MATERIAL.wall);
  }
  for (let y = 1; y < height - 1; y++) {
    initial[y * width] = packPixel(MATERIAL.wall);
    initial[y * width + width - 1] = packPixel(MATERIAL.wall);
  }
  paintPixelCircle(initial, width, height, 63, 17, 9, MATERIAL.sand);
  paintPixelCircle(initial, width, height, 68, 35, 11, MATERIAL.water);
  paintPixelCircle(initial, width, height, 32, 79, 7, MATERIAL.gas);
  const full = await WasmSimdPixelBlock.create(width, height);
  full.set(initial);
  const active = await WasmActiveSimdPixelBlock.create(
    initial,
    width,
    height,
    0x1234_5678,
    32,
  );
  const counts = countPixelMaterials(initial);

  for (let tick = 0; tick < 180; tick++) {
    full.step(tick, 0x1234_5678);
    active.step(tick);
  }

  assertEquals(
    Array.from(active.cells),
    Array.from(full.cells),
    "active cells",
  );
  assertEquals(countPixelMaterials(active.cells), counts, "material counts");
  assertEquals(
    active.activeChunkCount < active.chunkCount,
    true,
    "localized activity",
  );
});

Deno.test("active SIMD blocks cool an idle world and can be woken", async () => {
  const width = 128;
  const height = 96;
  const cells = new Uint32Array(width * height);
  const active = await WasmActiveSimdPixelBlock.create(cells, width, height);
  active.activateRect(10, 10, 10, 10);

  active.step(0);
  active.step(1);
  const sleeping = active.step(2);
  assertEquals(sleeping, { moves: 0, activeChunks: 0 });

  active.cells[20 * width + 65] = packPixel(MATERIAL.sand);
  active.activateRect(65, 20, 65, 20);
  const woken = active.step(3);
  const moved = active.step(4);
  assertEquals(woken.activeChunks > 0, true, "brush wakes chunks");
  assertEquals(moved.moves > 0, true, "painted sand moves");
});

Deno.test("active SIMD lets fully bonded gel chunks sleep", async () => {
  const width = 64;
  const height = 64;
  const cells = new Uint32Array(width * height);
  cells[32 * width + 32] = packPixel(
    MATERIAL.gel,
    128,
    PIXEL_GEL_BONDED_FLAG,
  );
  cells[33 * width + 32] = packPixel(MATERIAL.wall);
  const active = await WasmActiveSimdPixelBlock.create(cells, width, height);

  active.step(0);
  active.step(1);
  const sleeping = active.step(2);

  assertEquals(sleeping, { moves: 0, activeChunks: 0 });
});

Deno.test("active SIMD revisions change only around moved chunks", async () => {
  const width = 96;
  const height = 64;
  const cells = new Uint32Array(width * height);
  cells[8 * width + 8] = packPixel(MATERIAL.sand);
  const active = await WasmActiveSimdPixelBlock.create(cells, width, height);
  const baseBytes = active.residentBytes;
  active.enableRegionRevisions();
  assertEquals(
    active.residentBytes,
    baseBytes + active.chunkCount * Uint32Array.BYTES_PER_ELEMENT,
    "revision storage is opt-in",
  );
  const nearBefore = active.regionRevision(0, 0, 31, 31);
  const farBefore = active.regionRevision(64, 0, 95, 31);

  active.step(0);

  assertEquals(
    active.regionRevision(0, 0, 31, 31) > nearBefore,
    true,
    "moved chunk revision advances",
  );
  assertEquals(
    active.regionRevision(64, 0, 95, 31),
    farBefore,
    "unrelated chunk revision stays stable",
  );
});
