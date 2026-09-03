import {
  DEFAULT_WASM_PIXEL_BLOCK_SEED,
  WasmSimdPixelBlock,
} from "./pixel_block_kernel.ts";
import { PixelChunkActivity } from "./pixel_chunk_activity.ts";
import { materialIsMovable } from "./pixel_material.ts";

export interface PixelBlockActiveKernelStepResult {
  readonly moves: number;
  readonly activeChunks: number;
}

/** Schedules half-open active chunk ranges over one resident row-major Wasm SIMD world. */
export class WasmActiveSimdPixelBlock {
  readonly activity: PixelChunkActivity;
  readonly #kernel: WasmSimdPixelBlock;
  readonly #seed: number;
  #chunkRevision: Uint32Array | undefined;
  #revision = 0;

  private constructor(
    kernel: WasmSimdPixelBlock,
    activity: PixelChunkActivity,
    seed: number,
  ) {
    this.#kernel = kernel;
    this.activity = activity;
    this.#seed = seed;
  }

  static async create(
    cells: Uint32Array,
    width: number,
    height: number,
    seed = DEFAULT_WASM_PIXEL_BLOCK_SEED,
    chunkSize = 32,
    minimumMemoryBytes?: number,
  ): Promise<WasmActiveSimdPixelBlock> {
    const kernel = await WasmSimdPixelBlock.create(
      width,
      height,
      minimumMemoryBytes,
    );
    kernel.set(cells);
    const activity = new PixelChunkActivity(width, height, chunkSize);
    for (let index = 0; index < cells.length; index++) {
      const material = cells[index]! & 0xff;
      if (materialIsMovable(material)) {
        activity.activateCell(index % width, Math.floor(index / width));
      }
    }
    return new WasmActiveSimdPixelBlock(kernel, activity, seed);
  }

  step(tick: number): PixelBlockActiveKernelStepResult {
    const activeChunks = this.activity.activeChunkCount;
    let moves = 0;
    this.activity.beginStep();
    this.activity.forEachActiveChunk((bounds) => {
      const result = this.#kernel.stepRange(
        tick,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        this.#seed,
      );
      moves += result.moves;
      if (result.moves > 0 && this.#chunkRevision !== undefined) {
        this.#markChunkChanged(bounds.index);
      }
      if (result.hot) this.activity.markChunkHot(bounds.index);
    });
    this.activity.finishStep();
    return { moves, activeChunks };
  }

  activateRect(left: number, top: number, right: number, bottom: number): void {
    this.activity.activateRect(left, top, right, bottom);
  }

  enableRegionRevisions(): void {
    this.#chunkRevision ??= new Uint32Array(this.activity.chunkCount);
  }

  markCellChanged(x: number, y: number): void {
    if (
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 ||
      x >= this.#kernel.width || y >= this.#kernel.height
    ) throw new RangeError("changed cell is outside the pixel world");
    const chunkX = Math.floor(x / this.activity.chunkSize);
    const chunkY = Math.floor(y / this.activity.chunkSize);
    this.activity.activateCell(x, y);
    if (this.#chunkRevision !== undefined) {
      this.#markChunkChanged(chunkY * this.activity.chunksX + chunkX);
    }
  }

  regionRevision(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ): number {
    const chunkRevision = this.#chunkRevision;
    if (chunkRevision === undefined) {
      throw new Error("region revisions are not enabled");
    }
    if (
      !Number.isFinite(left) || !Number.isFinite(top) ||
      !Number.isFinite(right) || !Number.isFinite(bottom) ||
      left < 0 || top < 0 || right < left || bottom < top ||
      right >= this.#kernel.width || bottom >= this.#kernel.height
    ) throw new RangeError("revision region is outside the pixel world");
    const startX = Math.floor(left / this.activity.chunkSize);
    const endX = Math.floor(right / this.activity.chunkSize);
    const startY = Math.floor(top / this.activity.chunkSize);
    const endY = Math.floor(bottom / this.activity.chunkSize);
    let revision = 0;
    for (let chunkY = startY; chunkY <= endY; chunkY++) {
      for (let chunkX = startX; chunkX <= endX; chunkX++) {
        revision = Math.max(
          revision,
          chunkRevision[chunkY * this.activity.chunksX + chunkX]!,
        );
      }
    }
    return revision;
  }

  get cells(): Uint32Array {
    return this.#kernel.cells;
  }

  get memory(): WebAssembly.Memory {
    return this.#kernel.memory;
  }

  get activeChunkCount(): number {
    return this.activity.activeChunkCount;
  }

  get chunkCount(): number {
    return this.activity.chunkCount;
  }

  get residentBytes(): number {
    return this.#kernel.memory.buffer.byteLength +
      this.activity.chunkCount * 3 +
      (this.#chunkRevision?.byteLength ?? 0);
  }

  #markChunkChanged(index: number): void {
    const chunkRevision = this.#chunkRevision;
    if (chunkRevision === undefined) return;
    this.#revision = (this.#revision + 1) >>> 0;
    if (this.#revision === 0) {
      chunkRevision.fill(0);
      this.#revision = 1;
    }
    const centerX = index % this.activity.chunksX;
    const centerY = Math.floor(index / this.activity.chunksX);
    for (
      let chunkY = Math.max(0, centerY - 1);
      chunkY <= Math.min(this.activity.chunksY - 1, centerY + 1);
      chunkY++
    ) {
      for (
        let chunkX = Math.max(0, centerX - 1);
        chunkX <= Math.min(this.activity.chunksX - 1, centerX + 1);
        chunkX++
      ) {
        chunkRevision[chunkY * this.activity.chunksX + chunkX] = this.#revision;
      }
    }
  }
}
