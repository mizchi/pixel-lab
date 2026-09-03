import { type PixelRodStepResult, PixelRodWorld } from "../src/rigid_rod.ts";
import { PixelRodSupport } from "../src/rigid_rod_support.ts";
import { WasmReactiveActiveSimdPixelBlock } from "../src/pixel_reactive_active_kernel.ts";
import { MATERIAL, packPixel, pixelMaterial } from "../src/pixel_sim.ts";
import { SimdUi, type UiContainer, type UiDocument } from "./dom.ts";
import "./rigid_demo.css";

const WIDTH = 256;
const HEIGHT = 160;
const MATERIAL_COLORS: readonly number[] = [
  0xff15100c,
  0xff615950,
  0xff3db0f0,
  0xffe88c2e,
  0xffd98acb,
  0xff4b4bff,
  0xff8a827c,
  0xff3569a8,
  0xff241912,
  0xff7a7470,
  0xff4bda58,
  0xff1e55ff,
  0xffd65ce8,
];
const ROD_STRESS_COLORS = [
  "#f4c45d",
  "#f3b34d",
  "#f19b3f",
  "#ef7d38",
  "#ed5d3b",
  "#eb3c42",
  "#ff2342",
  "#ff0f36",
] as const;

interface RigidScene {
  readonly pixels: WasmReactiveActiveSimdPixelBlock;
  readonly rods: PixelRodWorld;
  readonly support: PixelRodSupport;
  readonly impulseParticle: number;
}

export async function mountRigidDemo(host: HTMLElement): Promise<void> {
  document.title = "Pixel Rigid Lab";
  document.body.classList.add("life-mode", "pixel-mode", "rigid-mode");
  const ui = new SimdUi({ document: document as unknown as UiDocument });
  const running = ui.signal(true);
  const ticks = ui.signal(0);
  const activeRods = ui.signal(0);
  const brokenRods = ui.signal(0);
  const gelBonds = ui.signal(0);
  const stepTime = ui.signal(0);
  const root = ui.element("div", { className: "life-shell pixel-shell" }, [
    ui.element("header", { className: "life-hero" }, [
      ui.element("div", {}, [
        ui.element("p", { className: "eyebrow" }, ["PIXELS × CONSTRAINTS"]),
        ui.element("h1", {}, ["Rigid Lab"]),
        ui.element("p", { className: "life-lead" }, [
          "Breakable rods and shared-particle hinges over the SIMD pixel world.",
        ]),
      ]),
      ui.element("div", { className: "life-badge pixel-badge" }, [
        ui.element("span", {}, ["BACKEND"]),
        ui.element("strong", {}, ["HYBRID SIMD"]),
        ui.element("small", {}, [`${WIDTH} × ${HEIGHT} · XPBD-style rods`]),
      ]),
    ]),
    ui.element("section", { className: "life-stage" }, [
      ui.element("div", { className: "life-canvas-frame rigid-canvas-frame" }, [
        ui.element("canvas", {
          id: "rigid-canvas",
          width: WIDTH,
          height: HEIGHT,
          ariaLabel: "Interactive breakable rod and pixel material simulation",
          tabIndex: 0,
        }),
        ui.element("div", { className: "life-overlay" }, [
          ui.element("span", { className: "life-status-dot" }),
          ui.text([running], () => running.value ? "RUNNING" : "PAUSED"),
        ]),
        ui.element("div", { className: "rigid-label rigid-chain-label" }, [
          "SHARED HINGES",
        ]),
        ui.element("div", { className: "rigid-label rigid-bridge-label" }, [
          "LOADED BRIDGE",
        ]),
        ui.element("div", { className: "rigid-label rigid-gel-label" }, [
          "GEL BOND PAD",
        ]),
      ]),
      ui.element("aside", { className: "life-console" }, [
        ui.element("div", { className: "life-stats" }, [
          stat(
            ui,
            "ticks",
            ui.text([ticks], () => ticks.value.toLocaleString()),
          ),
          stat(
            ui,
            "step",
            ui.text([stepTime], () => `${stepTime.value.toFixed(2)} ms`),
          ),
          stat(
            ui,
            "active rods",
            ui.text([activeRods], () => activeRods.value.toString()),
          ),
          stat(
            ui,
            "broken rods",
            ui.text([brokenRods], () => brokenRods.value.toString()),
          ),
          stat(
            ui,
            "gel bonds",
            ui.text([gelBonds], () => gelBonds.value.toString()),
          ),
        ]),
        ui.element("div", { className: "life-controls rigid-controls" }, [
          ui.element("button", {
            id: "rigid-impulse",
            className: "life-primary",
          }, ["Impact bridge"]),
          ui.element("button", { id: "rigid-toggle" }, [
            ui.text([running], () => running.value ? "Pause" : "Play"),
          ]),
          ui.element("button", { id: "rigid-reset" }, ["Reset"]),
          ui.element("a", {
            href:
              "?run=pixel&runtime=worker-reaction-simd&size=512&occupancy=25&region=full",
          }, ["Material lab"]),
        ]),
        ui.element("p", { className: "life-hint" }, [
          "Sand and the falling chain load the bridge. Gold is relaxed; thick red is near breaking. Pull an orange joint to add stress.",
        ]),
      ]),
    ]),
    ui.element("footer", { className: "life-footer" }, [
      ui.element("span", {}, ["◆separate rigid entrypoint"]),
      ui.element("span", {}, ["◆SoA particles + distance constraints"]),
      ui.element("span", {}, ["◆shared particles form hinges"]),
      ui.element("span", {}, ["◆no extra per-pixel buffer"]),
    ]),
  ]);
  host.replaceChildren();
  await ui.mount(host as unknown as UiContainer, root);

  const canvas = required<HTMLCanvasElement>(host, "rigid-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (context === null) throw new Error("2D canvas is unavailable");
  const image = context.createImageData(WIDTH, HEIGHT);
  const output = new Uint32Array(image.data.buffer);
  let scene = await createScene();
  let totalBroken = 0;
  let draggedParticle = -1;
  let dragTargetX = 0;
  let dragTargetY = 0;

  required(host, "rigid-toggle").addEventListener("click", () => {
    running.value = !running.value;
  });
  required(host, "rigid-impulse").addEventListener("click", () => {
    scene.rods.setParticleVelocity(scene.impulseParticle, 0, 18);
    running.value = true;
  });
  required(host, "rigid-reset").addEventListener("click", async () => {
    scene = await createScene();
    draggedParticle = -1;
    totalBroken = 0;
    ticks.value = 0;
    running.value = true;
  });
  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerWorldPoint(canvas, event);
    draggedParticle = nearestParticle(scene.rods, point.x, point.y, 8);
    if (draggedParticle >= 0) {
      dragTargetX = point.x;
      dragTargetY = point.y;
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (draggedParticle < 0) return;
    const point = pointerWorldPoint(canvas, event);
    dragTargetX = point.x;
    dragTargetY = point.y;
  });
  const releasePointer = () => draggedParticle = -1;
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);

  const frame = () => {
    if (running.value) {
      const started = performance.now();
      for (let substep = 0; substep < 2; substep++) {
        if (draggedParticle >= 0) {
          scene.rods.pullParticleTowards(
            draggedParticle,
            dragTargetX,
            dragTargetY,
            0.35,
            8,
          );
        }
        const result = stepCoupledScene(scene, ticks.value * 2 + substep);
        totalBroken += result.brokenRods;
        activeRods.value = result.activeRods;
      }
      ticks.value++;
      stepTime.value = performance.now() - started;
      brokenRods.value = totalBroken;
      gelBonds.value = countGelBonds(scene.rods);
    }
    renderScene(context, image, output, scene);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function createScene(): Promise<RigidScene> {
  const cells = new Uint32Array(WIDTH * HEIGHT);
  fillRect(cells, 0, HEIGHT - 8, WIDTH - 1, HEIGHT - 1, MATERIAL.wall);
  fillRect(cells, 0, 0, 2, HEIGHT - 1, MATERIAL.wall);
  fillRect(cells, WIDTH - 3, 0, WIDTH - 1, HEIGHT - 1, MATERIAL.wall);
  fillRect(cells, 188, 117, 246, 124, MATERIAL.stone);
  fillRect(cells, 196, 112, 238, 116, MATERIAL.gel);
  fillRect(cells, 18, 126, 72, 151, MATERIAL.water);
  fillRect(cells, 25, 104, 65, 116, MATERIAL.sand);
  fillRect(cells, 98, 30, 126, 46, MATERIAL.sand);
  const pixels = await WasmReactiveActiveSimdPixelBlock.create(
    cells,
    WIDTH,
    HEIGHT,
    32,
  );
  pixels.enableRegionRevisions();
  const rods = new PixelRodWorld(64, 64);
  const support = new PixelRodSupport(1_024, pixels);

  const chainAnchor = rods.addParticle(42, 19, 0);
  let previous = chainAnchor;
  for (let link = 1; link <= 8; link++) {
    const particle = rods.addParticle(42, 19 + link * 11);
    rods.addRod(previous, particle, { breakStrain: 0.38 });
    previous = particle;
  }

  const bridgeParticles: number[] = [];
  for (let segment = 0; segment <= 8; segment++) {
    bridgeParticles.push(
      rods.addParticle(
        86 + segment * 12,
        71,
        segment === 0 || segment === 8 ? 0 : 1,
      ),
    );
  }
  for (let segment = 0; segment < bridgeParticles.length - 1; segment++) {
    rods.addRod(bridgeParticles[segment]!, bridgeParticles[segment + 1]!, {
      breakStrain: 0.24,
    });
  }

  const fallingChain: number[] = [];
  for (let link = 0; link <= 4; link++) {
    fallingChain.push(rods.addParticle(138 + link * 10, 26));
  }
  for (let link = 0; link < fallingChain.length - 1; link++) {
    rods.addRod(fallingChain[link]!, fallingChain[link + 1]!, {
      breakStrain: 0.3,
    });
  }

  const fallingLeft = rods.addParticle(207, 31);
  const fallingMiddle = rods.addParticle(220, 31);
  const fallingRight = rods.addParticle(233, 31);
  rods.addRod(fallingLeft, fallingMiddle, { breakStrain: 0.3 });
  rods.addRod(fallingMiddle, fallingRight, { breakStrain: 0.3 });
  return {
    pixels,
    rods,
    support,
    impulseParticle: bridgeParticles[Math.floor(bridgeParticles.length / 2)]!,
  };
}

function stepCoupledScene(scene: RigidScene, tick: number): PixelRodStepResult {
  const cells = scene.pixels.cells;
  const bounds = scene.support.overlay(cells, WIDTH, HEIGHT, scene.rods);
  try {
    if (bounds !== undefined) {
      scene.pixels.activateRect(
        Math.max(0, bounds.left - 1),
        Math.max(0, bounds.top - 1),
        Math.min(WIDTH - 1, bounds.right + 1),
        Math.min(HEIGHT - 1, bounds.bottom + 1),
      );
    }
    scene.pixels.step(tick);
    scene.support.applyPixelLoads(cells, WIDTH, HEIGHT, scene.rods);
    scene.support.applyRigidLoads(cells, WIDTH, HEIGHT, scene.rods);
    return scene.rods.step(cells, WIDTH, HEIGHT, {
      dt: 0.5,
      gravityY: 0.24,
      iterations: 8,
      gelBreakSpeed: 5,
    });
  } finally {
    scene.support.restore(cells);
  }
}

function renderScene(
  context: CanvasRenderingContext2D,
  image: ImageData,
  output: Uint32Array,
  scene: RigidScene,
): void {
  for (let index = 0; index < scene.pixels.cells.length; index++) {
    output[index] =
      MATERIAL_COLORS[pixelMaterial(scene.pixels.cells[index]!)] ??
        MATERIAL_COLORS[MATERIAL.empty]!;
  }
  context.putImageData(image, 0, 0);
  context.lineCap = "round";
  context.lineWidth = 2.2;
  for (let rod = 0; rod < scene.rods.rodCount; rod++) {
    if (!scene.rods.rodIsActive(rod)) continue;
    const [aId, bId] = scene.rods.rodParticles(rod);
    const a = scene.rods.particlePosition(aId);
    const b = scene.rods.particlePosition(bId);
    const stress = Math.min(1, scene.rods.rodStress(rod));
    context.lineWidth = 2.2 + stress * 2;
    context.strokeStyle = ROD_STRESS_COLORS[
      Math.min(
        ROD_STRESS_COLORS.length - 1,
        stress * ROD_STRESS_COLORS.length,
      ) |
      0
    ]!;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }
  context.globalAlpha = 1;
  for (let particle = 0; particle < scene.rods.particleCount; particle++) {
    const point = scene.rods.particlePosition(particle);
    context.fillStyle = scene.rods.particleBondCell(particle) >= 0
      ? "#ff65df"
      : scene.rods.particleIsPinned(particle)
      ? "#f4fff8"
      : "#ff9f43";
    context.beginPath();
    context.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    context.fill();
  }
}

function nearestParticle(
  rods: PixelRodWorld,
  x: number,
  y: number,
  radius: number,
): number {
  let nearest = -1;
  let nearestDistance = radius * radius;
  for (let particle = 0; particle < rods.particleCount; particle++) {
    if (rods.particleIsPinned(particle)) continue;
    const point = rods.particlePosition(particle);
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < nearestDistance) {
      nearest = particle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function countGelBonds(rods: PixelRodWorld): number {
  let count = 0;
  for (let particle = 0; particle < rods.particleCount; particle++) {
    if (rods.particleBondCell(particle) >= 0) count++;
  }
  return count;
}

function pointerWorldPoint(
  canvas: HTMLCanvasElement,
  event: PointerEvent,
): { readonly x: number; readonly y: number } {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * WIDTH / bounds.width,
    y: (event.clientY - bounds.top) * HEIGHT / bounds.height,
  };
}

function fillRect(
  cells: Uint32Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
  material: (typeof MATERIAL)[keyof typeof MATERIAL],
): void {
  const packed = packPixel(material);
  for (let y = top; y <= bottom; y++) {
    cells.fill(packed, y * WIDTH + left, y * WIDTH + right + 1);
  }
}

function required<T extends HTMLElement>(host: HTMLElement, id: string): T {
  const element = host.querySelector<T>(`#${id}`);
  if (element === null) throw new Error(`missing demo element: ${id}`);
  return element;
}

function stat(
  ui: SimdUi,
  label: string,
  value: ReturnType<SimdUi["text"]>,
): ReturnType<SimdUi["element"]> {
  return ui.element("div", {}, [
    ui.element("span", {}, [label]),
    ui.element("strong", {}, [value]),
  ]);
}
