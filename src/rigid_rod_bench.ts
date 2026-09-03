import { PixelRodWorld } from "./rigid_rod.ts";
import { PixelRodSupport } from "./rigid_rod_support.ts";
import { WasmActiveSimdPixelBlock } from "./pixel_block_active_kernel.ts";
import { MATERIAL, packPixel } from "./pixel_sim.ts";

const WIDTH = 512;
const HEIGHT = 320;
const cells = new Uint32Array(WIDTH * HEIGHT);

for (const rodCount of [256, 1_024, 4_096] as const) {
  const world = createRodWorld(rodCount);
  Deno.bench({
    name: `rigid rods=${rodCount} iterations=8`,
    group: "rigid-rods",
    baseline: rodCount === 256,
    fn() {
      world.step(cells, WIDTH, HEIGHT, {
        gravityY: 0,
        iterations: 8,
      });
    },
  });

  const supportWorld = createRodWorld(rodCount);
  const support = new PixelRodSupport(rodCount * 4);
  Deno.bench({
    name: `rod support=${rodCount}`,
    group: "rigid-support",
    baseline: rodCount === 256,
    fn() {
      support.overlay(cells, WIDTH, HEIGHT, supportWorld);
      support.applyPixelLoads(cells, WIDTH, HEIGHT, supportWorld);
      support.restore(cells);
    },
  });

  const loaded = createLoadedSupportWorld(rodCount);
  const revisionWorld = await WasmActiveSimdPixelBlock.create(
    loaded.cells,
    WIDTH,
    loaded.height,
  );
  revisionWorld.enableRegionRevisions();
  const uncachedLoadedSupport = new PixelRodSupport(rodCount * 4);
  const cachedLoadedSupport = new PixelRodSupport(
    rodCount * 4,
    revisionWorld,
  );
  runSupport(
    cachedLoadedSupport,
    revisionWorld.cells,
    loaded.height,
    loaded.world,
  );
  for (
    const [name, loadedSupport] of [
      ["uncached", uncachedLoadedSupport],
      ["cached", cachedLoadedSupport],
    ] as const
  ) {
    Deno.bench({
      name: `${name} loaded support=${rodCount}`,
      group: `rigid-loaded-support-${rodCount}`,
      baseline: name === "uncached",
      fn() {
        runSupport(
          loadedSupport,
          revisionWorld.cells,
          loaded.height,
          loaded.world,
        );
      },
    });
  }
}

function createRodWorld(rodCount: number): PixelRodWorld {
  const world = new PixelRodWorld(rodCount * 2, rodCount);
  for (let rod = 0; rod < rodCount; rod++) {
    const column = rod % 128;
    const row = Math.floor(rod / 128);
    const left = world.addParticle(4 + column * 3, 4 + row * 3);
    const right = world.addParticle(6 + column * 3, 4 + row * 3);
    world.addRod(left, right, { breakStrain: 1 });
  }
  return world;
}

function createLoadedSupportWorld(rodCount: number): {
  cells: Uint32Array;
  height: number;
  world: PixelRodWorld;
} {
  const rows = Math.ceil(rodCount / 128);
  const height = 18 + rows * 18;
  const loadedCells = new Uint32Array(WIDTH * height);
  const world = new PixelRodWorld(rodCount * 2, rodCount);
  for (let rod = 0; rod < rodCount; rod++) {
    const column = rod % 128;
    const row = Math.floor(rod / 128);
    const x = 1 + column * 4;
    const y = 17 + row * 18;
    const left = world.addParticle(x, y);
    const right = world.addParticle(x + 2, y);
    world.addRod(left, right, { breakStrain: 1 });
    for (let depth = 1; depth <= 16; depth++) {
      for (let offset = 0; offset <= 2; offset++) {
        loadedCells[(y - depth) * WIDTH + x + offset] = packPixel(
          MATERIAL.sand,
        );
      }
    }
  }
  return { cells: loadedCells, height, world };
}

function runSupport(
  support: PixelRodSupport,
  supportCells: Uint32Array,
  height: number,
  world: PixelRodWorld,
): void {
  support.overlay(supportCells, WIDTH, height, world);
  support.applyPixelLoads(supportCells, WIDTH, height, world);
  support.restore(supportCells);
}
