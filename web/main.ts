import {
  parsePixelOccupancy,
  parsePixelRegion,
  parsePixelRuntime,
  parsePixelWidth,
} from "../src/pixel_options.ts";

const params = new URLSearchParams(location.search);
const run = params.get("run") ?? "pixel";

if (run === "pixel-block-webgpu-event-bench") {
  const { runPixelBlockWebGpuEventBenchmark } = await import(
    "./pixel_block_webgpu_event_bench.ts"
  );
  report({
    pixelBlockWebGpuEventBenchmark: await runPixelBlockWebGpuEventBenchmark(),
  });
} else if (run === "pixel-block-webgpu-check") {
  const {
    checkPixelBlockWebGpu,
    checkPixelBlockWebGpuEvents,
    checkPixelReactionWebGpuEvents,
  } = await import("./pixel_block_webgpu_check.ts");
  report({
    pixelBlockWebGpuCheck: await checkPixelBlockWebGpu(),
    pixelBlockWebGpuEventCheck: await checkPixelBlockWebGpuEvents(),
    pixelReactionWebGpuEventCheck: await checkPixelReactionWebGpuEvents(),
  });
} else if (run === "rigid") {
  const { mountRigidDemo } = await import("./rigid_demo.ts");
  await mountRigidDemo(document.querySelector("main")!);
} else if (run === "pixel") {
  const width = parsePixelWidth(params.get("size"));
  const { mountPixelDemo } = await import("./pixel_demo.ts");
  const result = await mountPixelDemo(
    document.querySelector("main")!,
    params.get("autorun") === "1",
    parsePixelRuntime(params.get("runtime")),
    width,
    width * 5 / 8,
    parsePixelOccupancy(params.get("occupancy")),
    parsePixelRegion(params.get("region")),
    parseMainLoad(params.get("load")),
  );
  if (result !== null) report({ pixel: result });
} else {
  throw new TypeError(`unknown Pixel Lab route: ${run}`);
}

function parseMainLoad(value: string | null): number {
  const milliseconds = value === null ? 0 : Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 8) {
    throw new RangeError(
      "main-thread load must be between zero and eight milliseconds",
    );
  }
  return milliseconds;
}

function report(result: unknown): void {
  void fetch("/__benchmark_report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  }).catch(() => {});
}
