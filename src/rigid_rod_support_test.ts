import { MATERIAL, packPixel } from "./pixel_sim.ts";
import { stepPixelWorldBlock } from "./pixel_block_sim.ts";
import {
  packRodSupportCell,
  PixelRodWorld,
  rodSupportOwner,
} from "./rigid_rod.ts";
import { PixelRodSupport } from "./rigid_rod_support.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

class CountingRodWorld extends PixelRodWorld {
  loadCalls = 0;

  override addRodLoad(rod: number, loadY: number): boolean {
    this.loadCalls++;
    return super.addRodLoad(rod, loadY);
  }
}

Deno.test("rod support markers retain a 4,096-scale rod id", () => {
  assertEquals(rodSupportOwner(packRodSupportCell(4_095)), 4_095);
});

Deno.test("rod support temporarily blocks pixels and transfers their weight", () => {
  const width = 12;
  const height = 10;
  const cells = new Uint32Array(width * height);
  for (let x = 2; x <= 6; x++) cells[3 * width + x] = packPixel(MATERIAL.sand);
  const rods = new PixelRodWorld(2, 1);
  const left = rods.addParticle(2, 4, 0);
  const right = rods.addParticle(6, 4);
  const rod = rods.addRod(left, right, { breakStrain: 1 });
  const support = new PixelRodSupport(16);

  const bounds = support.overlay(cells, width, height, rods);
  assertEquals(bounds, { left: 2, top: 4, right: 6, bottom: 4, count: 5 });
  stepPixelWorldBlock(cells, width, height, 1);
  assertEquals(cells[3 * width + 4]! & 0xff, MATERIAL.sand);
  const load = support.applyPixelLoads(cells, width, height, rods, {
    scale: 0.1,
    maxDepth: 4,
  });
  rods.step(cells, width, height, { gravityY: 0, iterations: 1 });

  assert(load > 0, "sand should apply a downward load");
  assert(rods.rodStress(rod) > 0, "the supported rod should become stressed");
  support.restore(cells);
  for (let x = 2; x <= 6; x++) assertEquals(cells[4 * width + x], 0);
});

Deno.test("static stone still contributes support weight", () => {
  const width = 8;
  const cells = new Uint32Array(width * 8);
  cells[2 * width + 3] = packPixel(MATERIAL.stone);
  const rods = new PixelRodWorld(2, 1);
  const left = rods.addParticle(2, 3, 0);
  const right = rods.addParticle(4, 3);
  rods.addRod(left, right);
  const support = new PixelRodSupport(8);

  support.overlay(cells, width, 8, rods);
  const load = support.applyPixelLoads(cells, width, 8, rods, { scale: 1 });

  assert(load > 0, "stone should have weight even though it is immovable");
  support.restore(cells);
});

Deno.test("adjacent support columns apply one aggregated load per rod", () => {
  const width = 12;
  const cells = new Uint32Array(width * 8);
  for (let x = 2; x <= 6; x++) {
    cells[2 * width + x] = packPixel(MATERIAL.sand);
  }
  const rods = new CountingRodWorld(2, 1);
  const left = rods.addParticle(2, 3, 0);
  const right = rods.addParticle(6, 3);
  rods.addRod(left, right);
  const support = new PixelRodSupport(16);

  support.overlay(cells, width, 8, rods);
  support.applyPixelLoads(cells, width, 8, rods);

  assertEquals(rods.loadCalls, 1);
  support.restore(cells);
});

Deno.test("unchanged support columns reuse cached material weight", () => {
  const width = 8;
  const cells = new Uint32Array(width * 10);
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 4; x++) {
      cells[y * width + x] = packPixel(MATERIAL.sand);
    }
  }
  let revision = 1;
  let revisionQueries = 0;
  const revisions = {
    regionRevision: () => {
      revisionQueries++;
      return revision;
    },
  };
  const rods = new PixelRodWorld(2, 1);
  const left = rods.addParticle(2, 6, 0);
  const right = rods.addParticle(4, 6);
  rods.addRod(left, right);
  const support = new PixelRodSupport(8, revisions);

  support.overlay(cells, width, 10, rods);
  const first = support.applyPixelLoads(cells, width, 10, rods);
  assertEquals(revisionQueries, 3);
  support.restore(cells);

  support.overlay(cells, width, 10, rods);
  const cached = support.applyPixelLoads(cells, width, 10, rods);
  assertEquals(cached, first);
  assertEquals(revisionQueries, 6);
  support.restore(cells);

  cells[1 * width + 3] = packPixel(MATERIAL.stone);
  support.overlay(cells, width, 10, rods);
  const stale = support.applyPixelLoads(cells, width, 10, rods);
  assert(stale === cached, "an unchanged revision should reuse cached weight");
  support.restore(cells);

  revision++;
  support.overlay(cells, width, 10, rods);
  const changed = support.applyPixelLoads(cells, width, 10, rods);
  assert(changed > cached, "a dirty column should refresh its cached weight");
  support.restore(cells);
});

Deno.test("shallow empty columns skip revision lookups", () => {
  const width = 8;
  const cells = new Uint32Array(width * 8);
  let revisionQueries = 0;
  const revisions = {
    regionRevision: () => {
      revisionQueries++;
      return 1;
    },
  };
  const rods = new PixelRodWorld(2, 1);
  const left = rods.addParticle(2, 3, 0);
  const right = rods.addParticle(4, 3);
  rods.addRod(left, right);
  const support = new PixelRodSupport(8, revisions);

  for (let tick = 0; tick < 2; tick++) {
    support.overlay(cells, width, 8, rods);
    support.applyPixelLoads(cells, width, 8, rods);
    support.restore(cells);
  }

  assertEquals(revisionQueries, 0);
});

Deno.test("a falling rod particle collides with a different supporting rod", () => {
  const width = 16;
  const height = 16;
  const cells = new Uint32Array(width * height);
  const rods = new PixelRodWorld(4, 2);
  const supportLeft = rods.addParticle(2, 8, 0);
  const supportRight = rods.addParticle(12, 8, 0);
  rods.addRod(supportLeft, supportRight);
  const fallingTop = rods.addParticle(7, 4);
  const fallingBottom = rods.addParticle(7, 6);
  rods.addRod(fallingTop, fallingBottom);
  rods.setParticleVelocity(fallingBottom, 0, 4);
  const support = new PixelRodSupport(32);

  support.overlay(cells, width, height, rods);
  rods.step(cells, width, height, { gravityY: 0, iterations: 1 });

  assert(
    rods.particlePosition(fallingBottom).y < 8,
    "the falling chain should not pass through the supporting rod",
  );
  support.restore(cells);
});

Deno.test("the weight of one rod can break another rod", () => {
  const width = 16;
  const height = 16;
  const cells = new Uint32Array(width * height);
  const rods = new PixelRodWorld(4, 2);
  const supportLeft = rods.addParticle(2, 8, 0);
  const supportRight = rods.addParticle(12, 8);
  const supportingRod = rods.addRod(supportLeft, supportRight, {
    breakStrain: 0.05,
  });
  const loadLeft = rods.addParticle(6, 6);
  const loadRight = rods.addParticle(7, 7);
  rods.addRod(loadLeft, loadRight);
  const support = new PixelRodSupport(32);

  support.overlay(cells, width, height, rods);
  const supportedParticles = support.applyRigidLoads(
    cells,
    width,
    height,
    rods,
    { loadPerParticle: 8, probeDepth: 2 },
  );
  rods.step(cells, width, height, { gravityY: 0, iterations: 1 });

  assert(supportedParticles > 0, "the upper rod should apply its weight");
  assertEquals(rods.rodIsActive(supportingRod), false);
  support.restore(cells);
});
