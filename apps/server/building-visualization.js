import { Worker } from "node:worker_threads";
import { ServiceError } from "./errors.js";

// One on-demand worker, no image store or queue. Reclaim compiler memory after
// every request and keep expensive compilation off Fastify's event loop.
export function createBuildingVisualizationService({ timeoutMs = 15_000 } = {}) {
  let active = null;
  let closed = false;
  return {
    async render(design, options) {
      if (active || closed) throw new ServiceError(503, "BUILDING_VISUALIZATION_BUSY", "Building visualizer is busy; retry shortly", {}, true);
      const worker = new Worker(new URL("./building-visualization-worker.js", import.meta.url), {
        workerData: { design, options },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        execArgv: []
      });
      active = worker;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new ServiceError(503, "BUILDING_VISUALIZATION_TIMEOUT", "Building visualization exceeded its time budget; simplify the design", {}, false)), timeoutMs);
          worker.once("message", (result) => {
            if (result.error) reject(new ServiceError(422, "BUILDING_VISUALIZATION_FAILED", result.error));
            else resolve({ png: Buffer.from(result.png), metadata: result.metadata });
          });
          worker.once("error", () => reject(new ServiceError(503, "BUILDING_VISUALIZATION_FAILED", "Building visualization worker failed or exceeded its memory budget")));
          worker.once("exit", () => reject(new ServiceError(503, "BUILDING_VISUALIZATION_FAILED", "Building visualization worker exited before producing an image")));
        });
      } finally {
        clearTimeout(timer);
        await worker.terminate();
        if (active === worker) active = null;
      }
    },
    async close() {
      closed = true;
      if (active) await active.terminate();
    }
  };
}

export function designVisualizationLink(design, cityId, config) {
  return {
    url: `${config.publicBaseUrl}/api/v1/cities/${encodeURIComponent(cityId)}/building-designs/${encodeURIComponent(design.id)}/visualization?revision=${design.revision}`,
    content_type: "image/png",
    optional: true,
    instruction: "Optional visual check before confirmation. GET with the same Bearer token; default is a 512px entrance-side image. Add view=back or view=top only if needed. No city resources are spent."
  };
}

export function registerBuildingVisualizationRoute(app, { repository, authenticate }) {
  const service = createBuildingVisualizationService();
  app.addHook("onClose", () => service.close());
  app.get("/api/v1/cities/:cityId/building-designs/:designId/visualization", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const principal = await authenticate(repository, request, "city:read");
    const design = await repository.getBuildingDesign(principal, request.params.cityId, request.params.designId);
    const { revision, view = "front", size = "512", ...unknown } = request.query;
    if (Object.keys(unknown).length || !["front", "back", "top"].includes(view) || !["512", "1024"].includes(String(size))
      || (revision !== undefined && (!/^[1-9]\d*$/.test(String(revision)) || !Number.isSafeInteger(Number(revision))))) {
      throw new ServiceError(400, "INVALID_REQUEST", "Use view=front|back|top, size=512|1024, and an optional positive revision");
    }
    if (revision !== undefined && Number(revision) !== design.revision) {
      throw new ServiceError(409, "BUILDING_DESIGN_REVISION_CONFLICT", "This preview link refers to an older design; read the current design", { current_revision: design.revision, spec_hash: design.specHash });
    }
    try {
      const { png, metadata } = await service.render(design, { view, size: Number(size) });
      return reply.type("image/png")
        .header("X-Design-Revision", String(design.revision))
        .header("X-Design-Hash", design.specHash)
        .header("X-Visualization-View", view)
        .header("X-Visualization-Renderer", metadata.rendererVersion)
        .header("Server-Timing", `compile;dur=${metadata.compileMs}, visualization;dur=${metadata.totalMs}`)
        .send(png);
    } catch (error) {
      if (error.code === "BUILDING_VISUALIZATION_BUSY") reply.header("Retry-After", "1");
      throw error;
    }
  });
}
