# Pixel Lab

Pixel-level 2D physics experiments across scalar JavaScript, Web Workers, Wasm SIMD, Atomics, and
resident WebGPU. The default lab visualizes density exchange, extinguishing and vaporization,
lava-water solidification, acid corrosion, and fuel ignition in parallel.

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

The same demo is deployed to
<https://mizchi.github.io/pixel-lab/?run=pixel&runtime=worker-reaction-simd&size=512&occupancy=25&region=full>.
GitHub Pages has no custom response-header configuration, so a site-scoped Service Worker adds the
COOP/COEP headers required by `SharedArrayBuffer`; it is not part of the application bundle.

The reaction Worker uses a compact `u32` cell ABI, active 2x2 movement, a dense SIMD thermal and
chemistry pass, `SharedArrayBuffer` input, and `OffscreenCanvas` presentation. Other query-selectable
backends retain scalar, sparse, SIMD, and WebGPU baselines.

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
