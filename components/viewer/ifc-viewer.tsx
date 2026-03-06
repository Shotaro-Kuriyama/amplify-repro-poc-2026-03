"use client";

import { Box3, Color, PerspectiveCamera, Sphere, Vector3, type Object3D } from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IfcViewerAPI } from "web-ifc-viewer";

import { cn } from "@/lib/utils";

type IfcViewerProps = {
  modelUrl: string | null;
  statusLabel: string;
};

type ViewerState = "idle" | "loading" | "ready" | "error";
const IFC_WASM_BASE_PATH = "/vendor/ifc/";
const IFC_WASM_FILE_URL = `${IFC_WASM_BASE_PATH}web-ifc.wasm`;

type InternalIfcManager = {
  loader?: {
    ifcManager?: {
      applyWebIfcConfig?: (settings: Record<string, unknown>) => Promise<void>;
      state?: {
        api?: {
          SetWasmPath?: (path: string, absolute?: boolean) => void;
          isWasmPathAbsolute?: boolean;
          wasmPath?: string;
        };
      };
      useWebWorkers?: (active: boolean, path?: string) => Promise<void>;
    };
    loadAsync?: (
      url: string,
      onProgress?: (event: ProgressEvent) => void,
    ) => Promise<unknown>;
  };
  addIfcModel?: (model: unknown) => void;
};

type CameraControlsApi = {
  fitToSphere?: (
    sphere: Sphere,
    enableTransition?: boolean,
  ) => Promise<unknown>;
  setTarget?: (
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean,
  ) => Promise<unknown>;
  setLookAt?: (
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean,
  ) => Promise<unknown>;
  getTarget?: (out: Vector3) => Vector3;
  getPosition?: (out: Vector3) => Vector3;
  getFocalOffset?: (out: Vector3) => Vector3;
  setFocalOffset?: (
    offsetX: number,
    offsetY: number,
    offsetZ: number,
    enableTransition?: boolean,
  ) => Promise<unknown>;
  update?: (delta: number) => void;
};

function getBoundingBoxCorners(bounds: Box3): Vector3[] {
  const { max, min } = bounds;
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
  ];
}

function getProjectedBoundsCenterNdc(bounds: Box3, camera: PerspectiveCamera) {
  const corners = getBoundingBoxCorners(bounds);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const ndc = corner.clone().project(camera);
    minX = Math.min(minX, ndc.x);
    minY = Math.min(minY, ndc.y);
    maxX = Math.max(maxX, ndc.x);
    maxY = Math.max(maxY, ndc.y);
  }

  return {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
  };
}

async function probeIfcWasmAsset() {
  const response = await fetch(IFC_WASM_FILE_URL, {
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "unknown";
  const bytes = (await response.arrayBuffer()).byteLength;

  console.info("[IFC Viewer] WASM probe", {
    bytes,
    contentType,
    status: response.status,
    url: IFC_WASM_FILE_URL,
  });

  if (!response.ok) {
    throw new Error(
      `WASM の取得に失敗しました (${response.status}, ${contentType}, ${bytes} bytes) ${IFC_WASM_FILE_URL}`,
    );
  }
}

async function configureIfcWasmPath(viewer: IfcViewerAPI, internalManager: InternalIfcManager) {
  await internalManager.loader?.ifcManager?.useWebWorkers?.(false);
  await viewer.IFC.setWasmPath(IFC_WASM_BASE_PATH);
  const api = internalManager.loader?.ifcManager?.state?.api;
  api?.SetWasmPath?.(IFC_WASM_BASE_PATH, true);

  if (api && api.isWasmPathAbsolute !== true) {
    throw new Error(
      `WASM absolute path 設定に失敗しました (wasmPath=${api.wasmPath ?? "unknown"})`,
    );
  }

  console.info("[IFC Viewer] wasmPath configured", {
    absolute: true,
    isWasmPathAbsolute: api?.isWasmPathAbsolute ?? null,
    runtimeWasmPath: api?.wasmPath ?? null,
    wasmPath: IFC_WASM_BASE_PATH,
  });
}

function getIfcModelsForFraming(viewer: IfcViewerAPI): Object3D[] {
  const models = viewer.context.items.ifcModels as unknown[];
  return models.filter(
    (model): model is Object3D =>
      typeof model === "object" && model !== null && "position" in model,
  );
}

async function focusIfcModelsInView(viewer: IfcViewerAPI) {
  const models = getIfcModelsForFraming(viewer);
  const bounds = new Box3();
  viewer.context.getScene().updateMatrixWorld(true);

  models.forEach((model) => {
    model.updateMatrixWorld(true);
    bounds.expandByObject(model);
  });

  if (bounds.isEmpty()) {
    viewer.context.fitToFrame();
    return;
  }

  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const controls = viewer.context.ifcCamera.cameraControls as unknown as CameraControlsApi;

  console.info("[IFC Viewer] model framing", {
    center: { x: center.x, y: center.y, z: center.z },
    modelCount: models.length,
    size: { x: size.x, y: size.y, z: size.z },
  });

  const camera = viewer.context.getCamera();
  const hasPerspectiveCamera =
    camera instanceof PerspectiveCamera || (camera as PerspectiveCamera).isPerspectiveCamera;
  const radius = Math.max(size.length() * 0.5, 0.001);
  const margin = 1.15;

  let viewDirection = new Vector3(1, 0.9, 1).normalize();
  if (controls.getPosition && controls.getTarget) {
    const currentPosition = controls.getPosition(new Vector3());
    const currentTarget = controls.getTarget(new Vector3());
    const delta = currentPosition.sub(currentTarget);
    if (delta.lengthSq() > 1e-8) {
      viewDirection = delta.normalize();
    }
  } else if ("position" in camera) {
    const cameraPosition = (camera as PerspectiveCamera).position.clone();
    const delta = cameraPosition.sub(center);
    if (delta.lengthSq() > 1e-8) {
      viewDirection = delta.normalize();
    }
  }

  let fitDistance = Math.max(size.x, size.y, size.z) * 1.6;
  if (hasPerspectiveCamera) {
    const perspectiveCamera = camera as PerspectiveCamera;
    const vFov = (perspectiveCamera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * perspectiveCamera.aspect);
    const distanceByHeight = radius / Math.sin(Math.max(vFov / 2, 0.001));
    const distanceByWidth = radius / Math.sin(Math.max(hFov / 2, 0.001));
    fitDistance = Math.max(distanceByHeight, distanceByWidth) * margin;
  }

  const fitPosition = center.clone().add(viewDirection.multiplyScalar(fitDistance));
  const lookTarget = center.clone();

  if (controls.setLookAt && controls.getTarget && controls.getPosition) {
    await controls.setFocalOffset?.(0, 0, 0, false);

    if (controls.fitToSphere) {
      const fitSphere = bounds.getBoundingSphere(new Sphere());
      await controls.fitToSphere(fitSphere, false);
      await controls.setTarget?.(center.x, center.y, center.z, false);
      await controls.setFocalOffset?.(0, 0, 0, false);
      controls.update?.(1 / 60);
    }

    await controls.setLookAt(
      fitPosition.x,
      fitPosition.y,
      fitPosition.z,
      lookTarget.x,
      lookTarget.y,
      lookTarget.z,
      false,
    );
    controls.update?.(1 / 60);

    if (hasPerspectiveCamera) {
      const perspectiveCamera = camera as PerspectiveCamera;
      for (let iteration = 0; iteration < 3; iteration += 1) {
        perspectiveCamera.updateMatrixWorld(true);
        const ndcCenter = getProjectedBoundsCenterNdc(bounds, perspectiveCamera);
        if (Math.abs(ndcCenter.x) < 0.01 && Math.abs(ndcCenter.y) < 0.01) {
          break;
        }

        const currentPosition = controls.getPosition(new Vector3());
        const currentTarget = controls.getTarget(new Vector3());
        const distance = currentPosition.distanceTo(currentTarget);
        const vFov = (perspectiveCamera.fov * Math.PI) / 180;
        const halfHeight = Math.tan(vFov / 2) * distance;
        const halfWidth = halfHeight * perspectiveCamera.aspect;

        const forward = currentTarget.clone().sub(currentPosition).normalize();
        const right = forward.clone().cross(perspectiveCamera.up).normalize();
        const up = right.clone().cross(forward).normalize();
        const worldShift = right
          .multiplyScalar(ndcCenter.x * halfWidth)
          .add(up.multiplyScalar(ndcCenter.y * halfHeight));

        const adjustedPosition = currentPosition.add(worldShift);
        const adjustedTarget = currentTarget.add(worldShift);

        await controls.setLookAt(
          adjustedPosition.x,
          adjustedPosition.y,
          adjustedPosition.z,
          adjustedTarget.x,
          adjustedTarget.y,
          adjustedTarget.z,
          false,
        );
        controls.update?.(1 / 60);
      }
    }

    const targetAfter = controls.getTarget(new Vector3());
    const positionAfter = controls.getPosition(new Vector3());
    const focalOffsetAfter = controls.getFocalOffset?.(new Vector3()) ?? new Vector3(0, 0, 0);
    const projectedCenter = hasPerspectiveCamera
      ? getProjectedBoundsCenterNdc(bounds, camera as PerspectiveCamera)
      : { x: 0, y: 0 };
    console.info("[IFC Viewer] projected center", {
      focalOffsetAfter: {
        x: focalOffsetAfter.x,
        y: focalOffsetAfter.y,
        z: focalOffsetAfter.z,
      },
      positionAfter: {
        x: positionAfter.x,
        y: positionAfter.y,
        z: positionAfter.z,
      },
      targetAfter: {
        x: targetAfter.x,
        y: targetAfter.y,
        z: targetAfter.z,
      },
      x: projectedCenter.x,
      y: projectedCenter.y,
    });
    return;
  }

  if ("position" in camera && "lookAt" in camera) {
    (camera as PerspectiveCamera).position.copy(fitPosition);
    (camera as PerspectiveCamera).lookAt(center);
  }
}

export function IfcViewer({ modelUrl, statusLabel }: IfcViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<IfcViewerAPI | null>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [viewerState, setViewerState] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const effectiveUrl = useMemo(() => modelUrl, [modelUrl]);

  useEffect(() => {
    let cancelled = false;

    async function setupViewer() {
      if (!containerRef.current || viewerRef.current) {
        return;
      }

      setViewerState("loading");

      try {
        const { IfcViewerAPI } = await import("web-ifc-viewer");

        if (cancelled || !containerRef.current) {
          return;
        }

        const viewer = new IfcViewerAPI({
          backgroundColor: new Color(0x020617),
          container: containerRef.current,
        });

        const ifcManager = viewer.IFC as unknown as InternalIfcManager;

        await probeIfcWasmAsset();
        await configureIfcWasmPath(viewer, ifcManager);
        viewer.axes.setAxes(2);
        viewer.grid.setGrid(20, 20);
        viewerRef.current = viewer;
        setIsViewerReady(true);
        setViewerState("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIsViewerReady(false);
        setViewerState("error");
        setErrorMessage(
          error instanceof Error ? error.message : "IFC Viewer の初期化に失敗しました。",
        );
      }
    }

    setupViewer();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadModel() {
      if (!viewerRef.current || !effectiveUrl || !isViewerReady) {
        return;
      }

      setViewerState("loading");
      setErrorMessage(null);

      try {
        const viewer = viewerRef.current;
        const existingModels = [...viewer.context.items.ifcModels];
        existingModels.forEach((model) => viewer.IFC.removeIfcModel(model.modelID));

        const ifcManager = viewer.IFC as unknown as InternalIfcManager;

        await probeIfcWasmAsset();
        await configureIfcWasmPath(viewer, ifcManager);

        await ifcManager.loader?.ifcManager?.applyWebIfcConfig?.({
          COORDINATE_TO_ORIGIN: false,
          USE_FAST_BOOLS: true,
        });
        await configureIfcWasmPath(viewer, ifcManager);

        const model = await ifcManager.loader?.loadAsync?.(effectiveUrl);

        if (!model || !ifcManager.addIfcModel) {
          throw new Error("IFC モデルのロードに失敗しました。");
        }

        ifcManager.addIfcModel(model);
        await focusIfcModelsInView(viewer);

        if (cancelled) {
          return;
        }

        setViewerState("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setViewerState("error");
        setErrorMessage(
          error instanceof Error ? error.message : "IFC ファイルの読み込みに失敗しました。",
        );
      }
    }

    loadModel();

    return () => {
      cancelled = true;
    };
  }, [effectiveUrl, isViewerReady]);

  useEffect(() => {
    return () => {
      const viewer = viewerRef.current;
      viewerRef.current = null;

      if (viewer) {
        void viewer.dispose();
      }
    };
  }, []);

  return (
    <div className="relative h-full min-h-[420px] overflow-hidden rounded-[1.25rem] border border-white/10 bg-slate-950">
      <div ref={containerRef} className="h-full min-h-[420px] w-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-slate-950 via-slate-950/70 to-transparent px-4 py-4">
        <div>
          <div className="text-xs uppercase tracking-[0.28em] text-sky-300">IFC Viewer</div>
          <div className="mt-1 text-sm text-slate-300">{statusLabel}</div>
        </div>
        <div
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            viewerState === "error"
              ? "border-rose-400/40 bg-rose-400/10 text-rose-100"
              : "border-white/20 bg-white/10 text-slate-100",
          )}
        >
          {viewerState === "loading"
            ? "loading"
            : viewerState === "error"
              ? "error"
              : "ready"}
        </div>
      </div>

      {viewerState === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/50 text-sm text-slate-300">
          IFCを読み込んでいます...
        </div>
      ) : null}

      {viewerState === "error" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/80 px-6 text-center text-sm leading-6 text-rose-100">
          {errorMessage ?? "Viewer の初期化に失敗しました。"}
        </div>
      ) : null}
    </div>
  );
}
