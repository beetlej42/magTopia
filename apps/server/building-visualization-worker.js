import { parentPort, workerData } from "node:worker_threads";
import { renderBuildingVisualization } from "../../src/render/buildingVisualization.js";

try {
  const { png, metadata } = renderBuildingVisualization(workerData.design, workerData.options);
  parentPort.postMessage({ png, metadata });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
