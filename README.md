# Pixel Lab

Pixel-level 2D physics experiments across scalar JavaScript, Web Workers, Wasm SIMD, Atomics, and
resident WebGPU. The default lab visualizes density exchange, extinguishing and vaporization,
lava-water solidification, acid corrosion, fuel ignition, and adhesive gel that fractures on impact
in parallel.

This repository was extracted from [`mizchi/jsimd`](https://github.com/mizchi/jsimd) after commit
[`fd849e3`](https://github.com/mizchi/jsimd/commit/fd849e3) so pixel-physics research can evolve
independently from the general-purpose SIMD library.

## Run

Requirements: Node.js 24+, pnpm, Deno, `just`, and `wasm-tools`.

```sh
pnpm install
just test
just dev
```

Open:

<http://127.0.0.1:5173/?run=pixel&runtime=worker-reaction-simd&size=512&occupancy=25&region=full>

The separate rod/hinge experiment is available at
<http://127.0.0.1:5173/?run=rigid>.

The same demo is deployed to
<https://mizchi.github.io/pixel-lab/?run=pixel&runtime=worker-reaction-simd&size=512&occupancy=25&region=full>.
GitHub Pages has no custom response-header configuration, so a site-scoped Service Worker adds the
COOP/COEP headers required by `SharedArrayBuffer`; it is not part of the application bundle.

The reaction Worker uses a compact `u32` cell ABI, active 2x2 movement, a dense SIMD thermal and
chemistry pass, `SharedArrayBuffer` input, and `OffscreenCanvas` presentation. Other query-selectable
backends retain scalar, sparse, SIMD, and WebGPU baselines.

Gel reuses the existing flags and variant bytes: resting gel bonds to wall, sand, stone, or wood;
free gel accumulates fall momentum; and impact above the break threshold fractures the bond for an
eight-tick cooldown before it can attach again. Its lateral flow is gated to one quarter of normal
fluid flow, so this adds no per-cell buffer.

The optional Rigid Lab overlays a fixed-capacity SoA particle/constraint layer without changing the
pixel ABI. Rods can share particles as hinges, break above a configured strain, collide with solid
pixels, and bond to or detach from gel. A sparse temporary support raster lets pixel-material columns
and other chains load and eventually break a rod without allocating a second full-grid buffer.
Four-or-more-cell material columns reuse loads until their active-chunk revision changes; empty and
shallow columns bypass revision lookup. Revision tracking and its buffers are opt-in, and the Rigid
JavaScript and CSS are loaded only by `?run=rigid`.

## Layout

- `src/`: physics contracts, scalar oracles, Wasm SIMD kernels, Atomics transport, and tests
- `web/`: interactive lab, Worker and WebGPU adapters, and browser checks
- `benchmarks/`: recorded reproducible measurements
- `tools/`: browser benchmark drivers
- [`RESEARCH.md`](./RESEARCH.md): implementation notes, tradeoffs, and measured boundaries

## Commands

```sh
just check
just bench-browser
just bench-block-webgpu-events
just bench-reaction-webgpu-events
just check-webgpu
```

## License

MIT
