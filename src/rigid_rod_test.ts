import { MATERIAL, packPixel } from "./pixel_sim.ts";
import { PixelRodWorld } from "./rigid_rod.ts";

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

function assertClose(actual: number, expected: number, epsilon = 1e-4): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`expected ${expected} ± ${epsilon}, got ${actual}`);
  }
}

Deno.test("rod distance constraints preserve length", () => {
  const world = new PixelRodWorld(4, 4);
  const left = world.addParticle(4, 4);
  const right = world.addParticle(12, 4);
  world.addRod(left, right, { breakStrain: 1 });
  world.setParticleVelocity(right, 3, 0);

  world.step(new Uint32Array(32 * 20), 32, 20, {
    gravityY: 0,
    iterations: 4,
  });

  const a = world.particlePosition(left);
  const b = world.particlePosition(right);
  assertClose(Math.hypot(b.x - a.x, b.y - a.y), 8);
});

Deno.test("rods can share a particle as a hinge", () => {
  const world = new PixelRodWorld(4, 4);
  const anchor = world.addParticle(8, 2, 0);
  const hinge = world.addParticle(8, 8);
  const end = world.addParticle(14, 8);
  world.addRod(anchor, hinge);
  world.addRod(hinge, end);

  world.step(new Uint32Array(32 * 24), 32, 24, {
    gravityY: 0.5,
    iterations: 8,
  });

  const a = world.particlePosition(anchor);
  const b = world.particlePosition(hinge);
  const c = world.particlePosition(end);
  assertEquals(a, { x: 8, y: 2 });
  assertClose(Math.hypot(b.x - a.x, b.y - a.y), 6, 1e-3);
  assertClose(Math.hypot(c.x - b.x, c.y - b.y), 6, 1e-3);
});

Deno.test("rod constraints break above their strain threshold", () => {
  const world = new PixelRodWorld(2, 1);
  const left = world.addParticle(4, 4);
  const right = world.addParticle(12, 4);
  const rod = world.addRod(left, right, { breakStrain: 0.2 });
  world.setParticlePosition(right, 20, 4);

  const result = world.step(new Uint32Array(32 * 20), 32, 20, {
    gravityY: 0,
  });

  assertEquals(result.brokenRods, 1);
  assertEquals(world.rodIsActive(rod), false);
});

Deno.test("rod stress reports strain relative to the break threshold", () => {
  const world = new PixelRodWorld(2, 1);
  const left = world.addParticle(4, 4, 0);
  const right = world.addParticle(12, 4);
  const rod = world.addRod(left, right, { breakStrain: 0.5 });
  world.setParticlePosition(right, 14, 4);

  world.step(new Uint32Array(32 * 20), 32, 20, {
    gravityY: 0,
    iterations: 1,
  });

  assertClose(world.rodStress(rod), 0.5);
  assertEquals(world.rodIsActive(rod), true);
});

Deno.test("gel bonds particles at low speed and releases them under impact", () => {
  const width = 12;
  const height = 12;
  const cells = new Uint32Array(width * height);
  const gelCell = 5 * width + 5;
  cells[gelCell] = packPixel(MATERIAL.gel);
  const world = new PixelRodWorld(2, 1);
  const particle = world.addParticle(5.5, 5.5);

  const bonded = world.step(cells, width, height, {
    gravityY: 0,
    gelBreakSpeed: 4,
  });
  assertEquals(bonded.bondedParticles, 1);
  assertEquals(world.particleBondCell(particle), gelCell);

  world.setParticleVelocity(particle, 8, 0);
  const released = world.step(cells, width, height, {
    gravityY: 0,
    gelBreakSpeed: 4,
  });
  assertEquals(released.detachedParticles, 1);
  assertEquals(world.particleBondCell(particle), -1);
});

Deno.test("a gel bond releases when its source pixel disappears", () => {
  const width = 8;
  const cells = new Uint32Array(width * 8);
  const gelCell = 3 * width + 3;
  cells[gelCell] = packPixel(MATERIAL.gel);
  const world = new PixelRodWorld(1, 1);
  const particle = world.addParticle(3.5, 3.5);
  world.step(cells, width, 8, { gravityY: 0 });
  assertEquals(world.particleBondCell(particle), gelCell);

  cells[gelCell] = packPixel(MATERIAL.empty);
  const result = world.step(cells, width, 8, { gravityY: 0 });

  assertEquals(result.detachedParticles, 1);
  assertEquals(world.particleBondCell(particle), -1);
});

Deno.test("solid pixels stop particle penetration", () => {
  const width = 12;
  const height = 12;
  const cells = new Uint32Array(width * height);
  cells[6 * width + 5] = packPixel(MATERIAL.wall);
  const world = new PixelRodWorld(2, 1);
  const particle = world.addParticle(5.5, 5.2);
  world.setParticleVelocity(particle, 0, 2);

  world.step(cells, width, height, { gravityY: 0 });

  const position = world.particlePosition(particle);
  assert(position.y < 6, `particle penetrated the wall at y=${position.y}`);
});

Deno.test("rigid storage scales with entity capacity instead of pixel count", () => {
  const world = new PixelRodWorld(4, 4);

  assertEquals(world.residentBytes, 4 * 32 + 4 * 21);

  world.addParticle(1, 1);
  world.step(new Uint32Array(16), 4, 4, { gravityY: 0 });
  assertEquals(world.residentBytes, 212);
});

Deno.test("particle pulling approaches a target with bounded speed", () => {
  const world = new PixelRodWorld(2, 1);
  const movable = world.addParticle(2, 2);
  const pinned = world.addParticle(4, 2, 0);

  assertEquals(world.pullParticleTowards(movable, 100, 2, 0.5, 6), true);
  assertEquals(world.pullParticleTowards(pinned, 100, 2, 0.5, 6), false);
  world.step(new Uint32Array(128 * 8), 128, 8, {
    gravityY: 0,
    iterations: 1,
  });

  assertClose(world.particlePosition(movable).x, 8);
  assertEquals(world.particlePosition(pinned), { x: 4, y: 2 });
});
