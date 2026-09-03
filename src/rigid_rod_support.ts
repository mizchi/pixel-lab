import { MATERIAL, materialDensity } from "./pixel_material.ts";
import {
  packRodSupportCell,
  PixelRodWorld,
  rodSupportOwner,
} from "./rigid_rod.ts";

const INVALID_REVISION = 0xffff_ffff;
const MIN_CACHED_DEPTH = 4;

export interface PixelRodSupportBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly count: number;
}

export interface PixelRodLoadOptions {
  readonly scale?: number;
  readonly maxDepth?: number;
}

export interface RigidRodLoadOptions {
  readonly loadPerParticle?: number;
  readonly probeDepth?: number;
}

export interface PixelRegionRevisionSource {
  regionRevision(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): number;
}

/** Sparse temporary pixel barriers and load transfer for active rod segments. */
export class PixelRodSupport {
  readonly #indices: Int32Array;
  readonly #revisions: PixelRegionRevisionSource | undefined;
  readonly #loadRevision: Uint32Array | undefined;
  readonly #cachedLoad: Float32Array | undefined;
  #count = 0;

  constructor(capacity: number, revisions?: PixelRegionRevisionSource) {
    positiveInteger(capacity, "rod support capacity");
    this.#indices = new Int32Array(capacity).fill(-1);
    this.#revisions = revisions;
    this.#loadRevision = revisions === undefined
      ? undefined
      : new Uint32Array(capacity);
    this.#cachedLoad = revisions === undefined
      ? undefined
      : new Float32Array(capacity);
  }

  overlay(
    cells: Uint32Array,
    width: number,
    height: number,
    rods: PixelRodWorld,
  ): PixelRodSupportBounds | undefined {
    validateGrid(cells, width, height);
    if (this.#count !== 0) {
      throw new Error("restore rod support cells before the next overlay");
    }
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let rod = 0; rod < rods.rodCount; rod++) {
      if (!rods.rodIsActive(rod)) continue;
      const [aId, bId] = rods.rodParticles(rod);
      const a = rods.particlePosition(aId);
      const b = rods.particlePosition(bId);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))),
      );
      const marker = packRodSupportCell(rod);
      for (let step = 0; step <= steps; step++) {
        const x = Math.floor(a.x + dx * step / steps);
        const y = Math.floor(a.y + dy * step / steps);
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const index = y * width + x;
        if ((cells[index]! & 0xff) !== MATERIAL.empty) continue;
        if (this.#count === this.#indices.length) continue;
        cells[index] = marker;
        if (
          this.#loadRevision !== undefined &&
          this.#indices[this.#count] !== index
        ) {
          this.#loadRevision[this.#count] = INVALID_REVISION;
        }
        this.#indices[this.#count++] = index;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return this.#count === 0
      ? undefined
      : { left, top, right, bottom, count: this.#count };
  }

  applyPixelLoads(
    cells: Uint32Array,
    width: number,
    height: number,
    rods: PixelRodWorld,
    options: PixelRodLoadOptions = {},
  ): number {
    validateGrid(cells, width, height);
    const scale = options.scale ?? 0.014;
    const maxDepth = options.maxDepth ?? 16;
    finiteNonNegative(scale, "pixel rod load scale");
    positiveInteger(maxDepth, "pixel rod load depth");
    const revisions = this.#revisions;
    const loadRevisions = this.#loadRevision;
    const cachedLoads = this.#cachedLoad;
    let applied = 0;
    let pendingRod = -1;
    let pendingLoad = 0;
    for (let support = 0; support < this.#count; support++) {
      const index = this.#indices[support]!;
      const rod = rodSupportOwner(cells[index]!);
      if (rod < 0 || rod >= rods.rodCount || !rods.rodIsActive(rod)) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      let revision: number | undefined;
      let load = -1;
      if (
        revisions !== undefined && y > 0 &&
        loadRevisions![support] !== INVALID_REVISION
      ) {
        revision = revisions.regionRevision(
          x,
          Math.max(0, y - maxDepth),
          x,
          y - 1,
        );
        if (loadRevisions![support] === revision) {
          load = cachedLoads![support]!;
        }
      }
      if (load < 0) {
        load = 0;
        let loadedDepth = 0;
        let cell = index - width;
        for (
          let depth = 0;
          depth < maxDepth && cell >= 0;
          depth++, cell -= width
        ) {
          const material = cells[cell]! & 0xff;
          if (
            material === MATERIAL.empty || rodSupportOwner(cells[cell]!) >= 0
          ) break;
          if (material === MATERIAL.wall) break;
          load += supportWeight(material);
          loadedDepth++;
        }
        if (
          revisions !== undefined && y > 0 &&
          loadedDepth >= MIN_CACHED_DEPTH
        ) {
          revision ??= revisions.regionRevision(
            x,
            Math.max(0, y - maxDepth),
            x,
            y - 1,
          );
          loadRevisions![support] = revision;
          cachedLoads![support] = load;
        } else if (loadRevisions !== undefined) {
          loadRevisions[support] = INVALID_REVISION;
        }
      }
      if (load !== 0) {
        if (rod !== pendingRod) {
          if (pendingLoad !== 0) {
            applied += applyWeightedRodLoad(
              rods,
              pendingRod,
              pendingLoad,
              scale,
            );
          }
          pendingRod = rod;
          pendingLoad = 0;
        }
        pendingLoad += load;
      }
    }
    return pendingLoad === 0
      ? applied
      : applied + applyWeightedRodLoad(rods, pendingRod, pendingLoad, scale);
  }

  applyRigidLoads(
    cells: Uint32Array,
    width: number,
    height: number,
    rods: PixelRodWorld,
    options: RigidRodLoadOptions = {},
  ): number {
    validateGrid(cells, width, height);
    const loadPerParticle = options.loadPerParticle ?? 1.5;
    const probeDepth = options.probeDepth ?? 24;
    finiteNonNegative(loadPerParticle, "rigid rod particle load");
    positiveInteger(probeDepth, "rigid rod probe depth");
    let supported = 0;
    for (let particle = 0; particle < rods.particleCount; particle++) {
      if (rods.particleIsPinned(particle)) continue;
      const point = rods.particlePosition(particle);
      const x = Math.floor(point.x);
      const startY = Math.floor(point.y);
      if (x < 0 || x >= width || startY < 0 || startY >= height) continue;
      for (let offset = 0; offset <= probeDepth; offset++) {
        const y = startY + offset;
        if (y >= height) break;
        const cell = cells[y * width + x]!;
        const rod = rodSupportOwner(cell);
        if (
          rod >= 0 && rod < rods.rodCount && rods.rodIsActive(rod) &&
          !rods.rodHasParticle(rod, particle)
        ) {
          if (rods.addRodLoad(rod, loadPerParticle)) supported++;
          break;
        }
        if (rod < 0 && offset > 0 && (cell & 0xff) === MATERIAL.empty) break;
      }
    }
    return supported;
  }

  restore(cells: Uint32Array): void {
    for (let support = 0; support < this.#count; support++) {
      const index = this.#indices[support]!;
      if (rodSupportOwner(cells[index]!) >= 0) cells[index] = 0;
    }
    this.#count = 0;
  }

  get residentBytes(): number {
    return this.#indices.byteLength + (this.#loadRevision?.byteLength ?? 0) +
      (this.#cachedLoad?.byteLength ?? 0);
  }
}

function validateGrid(cells: Uint32Array, width: number, height: number): void {
  positiveInteger(width, "support width");
  positiveInteger(height, "support height");
  if (cells.length !== width * height) {
    throw new RangeError("support dimensions must match cell storage");
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative`);
  }
}

function supportWeight(material: number): number {
  if (material === MATERIAL.stone) return 5;
  if (material === MATERIAL.wood) return 2;
  return Math.max(0, materialDensity(material));
}

function applyWeightedRodLoad(
  rods: PixelRodWorld,
  rod: number,
  load: number,
  scale: number,
): number {
  const [aId, bId] = rods.rodParticles(rod);
  const a = rods.particlePosition(aId);
  const b = rods.particlePosition(bId);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const weightedLoad = load * (length === 0 ? 0 : Math.abs(dx) / length) *
    scale;
  return rods.addRodLoad(rod, weightedLoad) ? weightedLoad : 0;
}
