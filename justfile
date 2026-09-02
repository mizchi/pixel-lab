set shell := ["bash", "-cu"]

default:
    @just --list

build-wasm:
    wasm-tools strip -a src/pixel_block_step.wat -o src/pixel_block_step.wasm
    wasm-tools strip -a src/pixel_reaction_step.wat -o src/pixel_reaction_step.wasm
    wasm-tools strip -a src/pixel_material_dispatch.wat -o src/pixel_material_dispatch.wasm
    wasm-tools validate --features simd src/pixel_block_step.wasm
    wasm-tools validate --features simd src/pixel_reaction_step.wasm
    wasm-tools validate --features simd src/pixel_material_dispatch.wasm

build-web: build-wasm
    pnpm --config.verify-deps-before-run=false exec tsc -p web/tsconfig.json
    pnpm --config.verify-deps-before-run=false exec vite build web

build: build-web

test: build-wasm
    deno test -A src web/dom_test.ts

check-bundles: build-web
    node_modules/esbuild/bin/esbuild fixtures/pixel-event-tape-entry.ts --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=fixtures/dist/pixel-event-tape.js
    test "$(gzip -9 -c web/dist/assets/pixel_demo-*.js | wc -c | tr -d ' ')" -le 5600
    test "$(gzip -9 -c fixtures/dist/pixel-event-tape.js | wc -c | tr -d ' ')" -le 1080
    test "$(wc -c < src/pixel_block_step.wasm | tr -d ' ')" -le 2390
    test "$(wc -c < src/pixel_reaction_step.wasm | tr -d ' ')" -le 2355

check: test check-bundles
    deno check tools/*.ts src/*_bench.ts fixtures/*.ts
    deno fmt --check src web fixtures tools benchlib

dev: build-wasm
    pnpm --config.verify-deps-before-run=false exec vite --host 127.0.0.1 web

bench-browser: build-web
    deno run -A tools/bench-ui-pixel-browser.ts

bench-block-webgpu-events: build-web
    deno run -A tools/bench-ui-pixel-block-webgpu-events.ts

bench-reaction-webgpu-events: build-web
    node_modules/esbuild/bin/esbuild fixtures/pixel-reaction-webgpu-bench-entry.ts --bundle --format=esm --platform=browser --target=es2022 --outfile=fixtures/dist/pixel-reaction-webgpu-bench.js
    cp src/pixel_reaction_step.wasm fixtures/dist/pixel_reaction_step.wasm
    deno run -A tools/bench-ui-pixel-reaction-webgpu-events.ts

check-webgpu: build-web
    deno run -A tools/check-ui-pixel-block-webgpu-browser.ts
