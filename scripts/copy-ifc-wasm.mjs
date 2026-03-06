import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const ifcSourceDir = resolve(projectRoot, "node_modules", "web-ifc");
const ifcTargetDir = resolve(projectRoot, "public", "vendor", "ifc");
const pdfTargetDir = resolve(projectRoot, "public", "vendor", "pdf");
const pdfRuntimeSource = resolve(
  projectRoot,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.min.mjs",
);
const pdfWorkerSource = resolve(
  projectRoot,
  "node_modules",
  "pdfjs-dist",
  "build",
  "pdf.worker.min.mjs",
);
const pdfRuntimeTarget = resolve(pdfTargetDir, "pdf.min.mjs");
const pdfWorkerTarget = resolve(projectRoot, "public", "pdf.worker.min.mjs");
const pdfWorkerTargetInVendor = resolve(pdfTargetDir, "pdf.worker.min.mjs");

const filesToCopy = [
  "web-ifc.wasm",
  "web-ifc-mt.wasm",
  "web-ifc-api.js",
  "web-ifc-api-browser.js",
];

await mkdir(ifcTargetDir, { recursive: true });
await mkdir(pdfTargetDir, { recursive: true });

await Promise.all(
  filesToCopy.map((fileName) =>
    cp(resolve(ifcSourceDir, fileName), resolve(ifcTargetDir, fileName)),
  ),
);

await Promise.all([
  cp(pdfRuntimeSource, pdfRuntimeTarget),
  cp(pdfWorkerSource, pdfWorkerTargetInVendor),
  cp(pdfWorkerSource, pdfWorkerTarget),
]);

console.log("Copied IFC runtime files and PDF runtime files to public");
