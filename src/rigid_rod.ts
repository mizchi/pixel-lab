import { MATERIAL, materialIsGelAnchor } from "./pixel_material.ts";

const ROD_SUPPORT_FLAG = 0x80;

export function packRodSupportCell(rod: number): number {
  if (!Number.isInteger(rod) || rod < 0 || rod >= 0x7fff) {
    throw new RangeError("rod support marker requires a rod below 32,767");
  }
  const code = rod + 1;
  return (
    MATERIAL.wall | 128 << 8 |
    (ROD_SUPPORT_FLAG | code & 0x7f) << 16 |
    (code >>> 7) << 24
  ) >>> 0;
}

export function rodSupportOwner(cell: number): number {
  const flags = cell >>> 16 & 0xff;
  if ((cell & 0xff) !== MATERIAL.wall || (flags & ROD_SUPPORT_FLAG) === 0) {
    return -1;
  }
  return (flags & 0x7f | cell >>> 24 << 7) - 1;
}

export interface PixelRodOptions {
  /** Relative length error that permanently breaks the constraint. */
  readonly breakStrain?: number;
}

export interface PixelRodStepOptions {
  readonly dt?: number;
  readonly gravityY?: number;
  readonly iterations?: number;
  readonly damping?: number;
  readonly gelBreakSpeed?: number;
}

export interface PixelRodStepResult {
  readonly activeRods: number;
  readonly brokenRods: number;
  readonly bondedParticles: number;
  readonly detachedParticles: number;
  readonly collisions: number;
}

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Fixed-capacity particle/rod layer stored separately from the pixel cell ABI.
 * Rods sharing a particle form a hinge without allocating graph objects per tick.
 */
export class PixelRodWorld {
  readonly #x: Float32Array;
  readonly #y: Float32Array;
  readonly #previousX: Float32Array;
  readonly #previousY: Float32Array;
  readonly #velocityX: Float32Array;
  readonly #velocityY: Float32Array;
  readonly #inverseMass: Float32Array;
  readonly #bondCell: Int32Array;
  readonly #rodA: Uint32Array;
  readonly #rodB: Uint32Array;
  readonly #rodLength: Float32Array;
  readonly #rodBreakStrain: Float32Array;
  readonly #rodPeakStrain: Float32Array;
  readonly #rodActive: Uint8Array;
  #particleCount = 0;
  #rodCount = 0;

  constructor(particleCapacity: number, rodCapacity: number) {
    positiveInteger(particleCapacity, "particle capacity");
    positiveInteger(rodCapacity, "rod capacity");
    this.#x = new Float32Array(particleCapacity);
    this.#y = new Float32Array(particleCapacity);
    this.#previousX = new Float32Array(particleCapacity);
    this.#previousY = new Float32Array(particleCapacity);
    this.#velocityX = new Float32Array(particleCapacity);
    this.#velocityY = new Float32Array(particleCapacity);
    this.#inverseMass = new Float32Array(particleCapacity);
    this.#bondCell = new Int32Array(particleCapacity).fill(-1);
    this.#rodA = new Uint32Array(rodCapacity);
    this.#rodB = new Uint32Array(rodCapacity);
    this.#rodLength = new Float32Array(rodCapacity);
    this.#rodBreakStrain = new Float32Array(rodCapacity);
    this.#rodPeakStrain = new Float32Array(rodCapacity);
    this.#rodActive = new Uint8Array(rodCapacity);
  }

  addParticle(x: number, y: number, inverseMass = 1): number {
    finite(x, "particle x");
    finite(y, "particle y");
    finiteNonNegative(inverseMass, "particle inverse mass");
    if (this.#particleCount === this.#x.length) {
      throw new RangeError("particle capacity exceeded");
    }
    const particle = this.#particleCount++;
    this.#x[particle] = x;
    this.#y[particle] = y;
    this.#previousX[particle] = x;
    this.#previousY[particle] = y;
    this.#inverseMass[particle] = inverseMass;
    return particle;
  }

  addRod(a: number, b: number, options: PixelRodOptions = {}): number {
    this.#validateParticle(a);
    this.#validateParticle(b);
    if (a === b) throw new RangeError("a rod requires two particles");
    if (this.#rodCount === this.#rodA.length) {
      throw new RangeError("rod capacity exceeded");
    }
    const length = Math.hypot(
      this.#x[b]! - this.#x[a]!,
      this.#y[b]! - this.#y[a]!,
    );
    if (length === 0) throw new RangeError("a rod requires non-zero length");
    const breakStrain = options.breakStrain ?? 0.6;
    finiteNonNegative(breakStrain, "rod break strain");
    const rod = this.#rodCount++;
    this.#rodA[rod] = a;
    this.#rodB[rod] = b;
    this.#rodLength[rod] = length;
    this.#rodBreakStrain[rod] = breakStrain;
    this.#rodActive[rod] = 1;
    return rod;
  }

  step(
    cells: Uint32Array,
    width: number,
    height: number,
    options: PixelRodStepOptions = {},
  ): PixelRodStepResult {
    validateGrid(cells, width, height);
    const dt = options.dt ?? 1;
    const gravityY = options.gravityY ?? 0.18;
    const iterations = options.iterations ?? 6;
    const damping = options.damping ?? 0.995;
    const gelBreakSpeed = options.gelBreakSpeed ?? 5;
    finitePositive(dt, "rod dt");
    finite(gravityY, "rod gravity");
    positiveInteger(iterations, "rod iterations");
    unitInterval(damping, "rod damping");
    finiteNonNegative(gelBreakSpeed, "gel break speed");
    let brokenRods = 0;
    let bondedParticles = 0;
    let detachedParticles = 0;
    let collisions = 0;

    for (let particle = 0; particle < this.#particleCount; particle++) {
      const x = this.#x[particle]!;
      const y = this.#y[particle]!;
      this.#previousX[particle] = x;
      this.#previousY[particle] = y;
      if (this.#inverseMass[particle] === 0) {
        this.#velocityX[particle] = 0;
        this.#velocityY[particle] = 0;
        continue;
      }
      if (this.#bondCell[particle] >= 0) {
        const bondCell = this.#bondCell[particle]!;
        const speed = Math.hypot(
          this.#velocityX[particle]!,
          this.#velocityY[particle]!,
        );
        if ((cells[bondCell]! & 0xff) !== MATERIAL.gel) {
          this.#bondCell[particle] = -1;
          detachedParticles++;
        } else if (speed <= gelBreakSpeed) {
          this.#velocityX[particle] = 0;
          this.#velocityY[particle] = 0;
          continue;
        } else {
          this.#bondCell[particle] = -1;
          detachedParticles++;
        }
      }
      this.#velocityY[particle] += gravityY * dt;
      this.#x[particle] += this.#velocityX[particle]! * dt;
      this.#y[particle] += this.#velocityY[particle]! * dt;
      const contact = this.#resolvePixelContact(
        particle,
        cells,
        width,
        height,
        gelBreakSpeed,
      );
      collisions += contact & 1;
      bondedParticles += contact >>> 1;
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
      for (let rod = 0; rod < this.#rodCount; rod++) {
        if (this.#rodActive[rod] === 0) continue;
        if (iteration === 0) this.#rodPeakStrain[rod] = 0;
        const a = this.#rodA[rod]!;
        const b = this.#rodB[rod]!;
        const dx = this.#x[b]! - this.#x[a]!;
        const dy = this.#y[b]! - this.#y[a]!;
        const distance = Math.hypot(dx, dy);
        const restLength = this.#rodLength[rod]!;
        const strain = Math.abs(distance - restLength) / restLength;
        const breakStrain = this.#rodBreakStrain[rod]!;
        if (strain > this.#rodPeakStrain[rod]!) {
          this.#rodPeakStrain[rod] = strain;
        }
        if (strain > breakStrain) {
          this.#rodActive[rod] = 0;
          brokenRods++;
          continue;
        }
        if (distance === 0) continue;
        const weightA = this.#effectiveInverseMass(a);
        const weightB = this.#effectiveInverseMass(b);
        const totalWeight = weightA + weightB;
        if (totalWeight === 0) continue;
        const correction = (distance - restLength) / distance / totalWeight;
        this.#x[a] += dx * correction * weightA;
        this.#y[a] += dy * correction * weightA;
        this.#x[b] -= dx * correction * weightB;
        this.#y[b] -= dy * correction * weightB;
      }
      for (let particle = 0; particle < this.#particleCount; particle++) {
        if (this.#effectiveInverseMass(particle) === 0) continue;
        const contact = this.#resolvePixelContact(
          particle,
          cells,
          width,
          height,
          gelBreakSpeed,
        );
        collisions += contact & 1;
        bondedParticles += contact >>> 1;
      }
    }

    let activeRods = 0;
    for (let rod = 0; rod < this.#rodCount; rod++) {
      activeRods += this.#rodActive[rod]!;
    }
    for (let particle = 0; particle < this.#particleCount; particle++) {
      if (this.#inverseMass[particle] === 0 || this.#bondCell[particle] >= 0) {
        this.#velocityX[particle] = 0;
        this.#velocityY[particle] = 0;
        continue;
      }
      this.#velocityX[particle] =
        (this.#x[particle]! - this.#previousX[particle]!) / dt * damping;
      this.#velocityY[particle] =
        (this.#y[particle]! - this.#previousY[particle]!) / dt * damping;
    }
    return {
      activeRods,
      brokenRods,
      bondedParticles,
      detachedParticles,
      collisions,
    };
  }

  setParticlePosition(particle: number, x: number, y: number): void {
    this.#validateParticle(particle);
    finite(x, "particle x");
    finite(y, "particle y");
    this.#x[particle] = x;
    this.#y[particle] = y;
  }

  setParticleVelocity(particle: number, x: number, y: number): void {
    this.#validateParticle(particle);
    finite(x, "particle velocity x");
    finite(y, "particle velocity y");
    this.#velocityX[particle] = x;
    this.#velocityY[particle] = y;
  }

  /** Adds a downward load to the movable endpoints of one active rod. */
  addRodLoad(rod: number, loadY: number): boolean {
    this.#validateRod(rod);
    finiteNonNegative(loadY, "rod load");
    if (this.#rodActive[rod] === 0) return false;
    const a = this.#rodA[rod]!;
    const b = this.#rodB[rod]!;
    const weightA = this.#effectiveInverseMass(a);
    const weightB = this.#effectiveInverseMass(b);
    const totalWeight = weightA + weightB;
    if (totalWeight === 0) return false;
    this.#velocityY[a] += loadY * weightA / totalWeight;
    this.#velocityY[b] += loadY * weightB / totalWeight;
    return true;
  }

  /** Applies a cursor-like spring velocity without teleporting the particle. */
  pullParticleTowards(
    particle: number,
    targetX: number,
    targetY: number,
    strength = 0.35,
    maxSpeed = 8,
  ): boolean {
    this.#validateParticle(particle);
    finite(targetX, "particle pull target x");
    finite(targetY, "particle pull target y");
    finitePositive(strength, "particle pull strength");
    finitePositive(maxSpeed, "particle pull maximum speed");
    if (this.#inverseMass[particle] === 0) return false;
    const dx = targetX - this.#x[particle]!;
    const dy = targetY - this.#y[particle]!;
    const distance = Math.hypot(dx, dy);
    const speed = Math.min(maxSpeed, distance * strength);
    if (distance === 0) {
      this.#velocityX[particle] = 0;
      this.#velocityY[particle] = 0;
    } else {
      this.#velocityX[particle] = dx / distance * speed;
      this.#velocityY[particle] = dy / distance * speed;
    }
    return true;
  }

  particlePosition(particle: number): PixelPoint {
    this.#validateParticle(particle);
    return { x: this.#x[particle]!, y: this.#y[particle]! };
  }

  particleBondCell(particle: number): number {
    this.#validateParticle(particle);
    return this.#bondCell[particle]!;
  }

  particleIsPinned(particle: number): boolean {
    this.#validateParticle(particle);
    return this.#inverseMass[particle] === 0;
  }

  rodParticles(rod: number): readonly [number, number] {
    this.#validateRod(rod);
    return [this.#rodA[rod]!, this.#rodB[rod]!];
  }

  rodIsActive(rod: number): boolean {
    this.#validateRod(rod);
    return this.#rodActive[rod] === 1;
  }

  rodHasParticle(rod: number, particle: number): boolean {
    this.#validateRod(rod);
    this.#validateParticle(particle);
    return this.#rodA[rod] === particle || this.#rodB[rod] === particle;
  }

  /** Peak strain observed this step, normalized so 1 reaches break strain. */
  rodStress(rod: number): number {
    this.#validateRod(rod);
    const strain = this.#rodPeakStrain[rod]!;
    const breakStrain = this.#rodBreakStrain[rod]!;
    return breakStrain === 0
      ? (strain === 0 ? 0 : Infinity)
      : strain / breakStrain;
  }

  get particleCount(): number {
    return this.#particleCount;
  }

  get rodCount(): number {
    return this.#rodCount;
  }

  get residentBytes(): number {
    return this.#x.byteLength + this.#y.byteLength +
      this.#previousX.byteLength + this.#previousY.byteLength +
      this.#velocityX.byteLength + this.#velocityY.byteLength +
      this.#inverseMass.byteLength + this.#bondCell.byteLength +
      this.#rodA.byteLength + this.#rodB.byteLength +
      this.#rodLength.byteLength + this.#rodBreakStrain.byteLength +
      this.#rodPeakStrain.byteLength +
      this.#rodActive.byteLength;
  }

  #effectiveInverseMass(particle: number): number {
    return this.#bondCell[particle] >= 0 ? 0 : this.#inverseMass[particle]!;
  }

  #resolvePixelContact(
    particle: number,
    cells: Uint32Array,
    width: number,
    height: number,
    gelBreakSpeed: number,
  ): number {
    const fromX = this.#previousX[particle]!;
    const fromY = this.#previousY[particle]!;
    const toX = Math.max(0, Math.min(width - 1e-3, this.#x[particle]!));
    const toY = Math.max(0, Math.min(height - 1e-3, this.#y[particle]!));
    this.#x[particle] = toX;
    this.#y[particle] = toY;
    const steps = Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(toX - fromX),
          Math.abs(toY - fromY),
        ) * 2,
      ),
    );
    const speed = Math.hypot(
      this.#velocityX[particle]!,
      this.#velocityY[particle]!,
    );
    for (let step = 1; step <= steps; step++) {
      const x = fromX + (toX - fromX) * step / steps;
      const y = fromY + (toY - fromY) * step / steps;
      const cellX = Math.floor(x);
      const cellY = Math.floor(y);
      const index = cellY * width + cellX;
      const cell = cells[index]!;
      const material = cell & 0xff;
      const supportRod = rodSupportOwner(cell);
      if (
        supportRod >= 0 && supportRod < this.#rodCount &&
        this.#rodActive[supportRod] === 1 &&
        this.rodHasParticle(supportRod, particle)
      ) continue;
      if (material === MATERIAL.gel && speed <= gelBreakSpeed) {
        this.#bondCell[particle] = index;
        this.#x[particle] = cellX + 0.5;
        this.#y[particle] = cellY + 0.5;
        return 2;
      }
      if (materialBlocksRigid(material)) {
        this.#x[particle] = fromX;
        this.#y[particle] = fromY;
        this.#velocityX[particle] = 0;
        this.#velocityY[particle] = 0;
        return 1;
      }
    }
    return 0;
  }

  #validateParticle(particle: number): void {
    if (
      !Number.isInteger(particle) || particle < 0 ||
      particle >= this.#particleCount
    ) {
      throw new RangeError(`unknown particle: ${particle}`);
    }
  }

  #validateRod(rod: number): void {
    if (!Number.isInteger(rod) || rod < 0 || rod >= this.#rodCount) {
      throw new RangeError(`unknown rod: ${rod}`);
    }
  }
}

function materialBlocksRigid(material: number): boolean {
  return materialIsGelAnchor(material);
}

function validateGrid(cells: Uint32Array, width: number, height: number): void {
  positiveInteger(width, "grid width");
  positiveInteger(height, "grid height");
  if (cells.length !== width * height) {
    throw new RangeError("grid dimensions must match cell storage");
  }
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function finitePositive(value: number, label: string): void {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
}

function finiteNonNegative(value: number, label: string): void {
  finite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
}

function unitInterval(value: number, label: string): void {
  finite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one`);
  }
}
