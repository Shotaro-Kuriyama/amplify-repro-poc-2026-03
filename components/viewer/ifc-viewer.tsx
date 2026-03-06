"use client";

import { Box3, Color, PerspectiveCamera, Sphere, Vector3, type Object3D } from "three";
import { useEffect, useRef, useState } from "react";
import type { IfcViewerAPI } from "web-ifc-viewer";

import { cn } from "@/lib/utils";

type IfcViewerProps = {
  modelUrl: string | null;
  statusLabel: string;
};

type ViewerState = "idle" | "loading" | "ready" | "error";

const IFC_WASM_BASE_PATH = "/vendor/ifc/";
const IFC_WASM_FILENAME = "web-ifc.wasm";

type InternalWebIfcApi = {
  SetWasmPath?: (path: string, absolute?: boolean) => void;
  isWasmPathAbsolute?: boolean;
  wasmPath?: string;
};

type InternalIfcManager = {
  setWasmPath?: (path: string) => Promise<void> | void;
  applyWebIfcConfig?: (settings: Record<string, unknown>) => Promise<void> | void;
  useWebWorkers?: (active: boolean, path?: string) => Promise<void> | void;
  state?: {
    api?: InternalWebIfcApi;
    models?: Record<string, unknown> | unknown[];
    wasmPath?: string;
    worker?: {
      active?: boolean;
      path?: string;
    };
    webIfcSettings?: Record<string, unknown>;
  };
};

type InternalIfcFacade = {
  loader?: {
    ifcManager?: InternalIfcManager;
  };
};

type CameraControlsApi = {
  fitToSphere?: (sphere: Sphere, enableTransition?: boolean) => Promise<unknown>;
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

type IfcStateDiagnostics = {
  invalidMeshModelIds: string[];
  missingGeometryModelIds: string[];
  modelCount: number;
  modelsWithGeometry: number;
};

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function buildAbsoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

function buildAbsoluteWasmBaseUrl() {
  return ensureTrailingSlash(buildAbsoluteUrl(IFC_WASM_BASE_PATH));
}

function buildAbsoluteWasmFileUrl() {
  return new URL(IFC_WASM_FILENAME, buildAbsoluteWasmBaseUrl()).toString();
}

function countOccurrences(source: string, token: string) {
  const matches = source.match(new RegExp(token, "g"));
  return matches ? matches.length : 0;
}

async function inspectIfcGeometryHints(modelUrl: string) {
  // NOTE: credentials は不要（静的 IFC ファイル取得のみ）。
  // credentials: "include" にするとバックエンド側の
  // allow_credentials=False と矛盾して CORS エラーになる。
  const response = await fetch(modelUrl, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`IFC ファイルの事前読込に失敗しました: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const hints = {
    IFCSHAPEREPRESENTATION: countOccurrences(text, "IFCSHAPEREPRESENTATION"),
    IFCEXTRUDEDAREASOLID: countOccurrences(text, "IFCEXTRUDEDAREASOLID"),
    IFCTRIANGULATEDFACESET: countOccurrences(text, "IFCTRIANGULATEDFACESET"),
    IFCPOLYGONALFACESET: countOccurrences(text, "IFCPOLYGONALFACESET"),
    IFCFACETEDBREP: countOccurrences(text, "IFCFACETEDBREP"),
  };
  const geometryTokenCount = Object.values(hints).reduce((sum, value) => sum + value, 0);

  return {
    bytes: text.length,
    geometryTokenCount,
    hasRenderableGeometryHint: geometryTokenCount > 0,
    hints,
  };
}

function collectIfcStateDiagnostics(ifcManager: InternalIfcManager | null): IfcStateDiagnostics {
  if (!ifcManager?.state?.models) {
    return {
      modelCount: 0,
      modelsWithGeometry: 0,
      invalidMeshModelIds: [],
      missingGeometryModelIds: [],
    };
  }

  const entries = Object.entries(ifcManager.state.models as Record<string, unknown>);
  const invalidMeshModelIds: string[] = [];
  const missingGeometryModelIds: string[] = [];
  let modelsWithGeometry = 0;

  for (const [id, model] of entries) {
    const mesh = (model as { mesh?: unknown } | undefined)?.mesh as
      | { removeFromParent?: unknown; geometry?: unknown }
      | undefined;

    const hasMeshObject = typeof mesh === "object" && mesh !== null;
    const hasRemoveFromParent =
      hasMeshObject && typeof (mesh as { removeFromParent?: unknown }).removeFromParent === "function";
    const hasGeometry = hasMeshObject && typeof (mesh as { geometry?: unknown }).geometry === "object";

    if (!hasRemoveFromParent) {
      invalidMeshModelIds.push(id);
      continue;
    }

    if (!hasGeometry) {
      missingGeometryModelIds.push(id);
      continue;
    }

    modelsWithGeometry += 1;
  }

  return {
    modelCount: entries.length,
    modelsWithGeometry,
    invalidMeshModelIds,
    missingGeometryModelIds,
  };
}

function sanitizeIfcStateForDispose(ifcManager: InternalIfcManager | null) {
  if (!ifcManager?.state?.models) {
    return [];
  }

  const models = ifcManager.state.models as Record<string, unknown>;
  const removedModelIds: string[] = [];

  for (const [id, model] of Object.entries(models)) {
    const mesh = (model as { mesh?: unknown } | undefined)?.mesh as
      | {
          removeFromParent?: unknown;
          geometry?: { dispose?: unknown; disposeBoundsTree?: unknown } | undefined;
        }
      | undefined;

    const hasRemoveFromParent = typeof mesh?.removeFromParent === "function";
    const hasGeometryDispose = typeof mesh?.geometry?.dispose === "function";
    if (hasRemoveFromParent && hasGeometryDispose) {
      continue;
    }

    removedModelIds.push(id);
    delete models[id];
  }

  return removedModelIds;
}

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

async function probeIfcWasmAsset(wasmFileUrl: string) {
  const response = await fetch(wasmFileUrl, {
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "unknown";
  const bytes = (await response.arrayBuffer()).byteLength;

  console.info("[IFC Viewer] WASM probe", {
    bytes,
    contentType,
    status: response.status,
    url: wasmFileUrl,
  });

  if (!response.ok) {
    throw new Error(
      `WASM の取得に失敗しました (${response.status}, ${contentType}, ${bytes} bytes): ${wasmFileUrl}`,
    );
  }
}

function getInternalIfcManager(viewer: IfcViewerAPI) {
  const internalIfc = viewer.IFC as unknown as InternalIfcFacade;
  return internalIfc.loader?.ifcManager ?? null;
}

async function configureIfcWasmPath(viewer: IfcViewerAPI) {
  const wasmBaseUrl = buildAbsoluteWasmBaseUrl();
  const ifcManager = getInternalIfcManager(viewer);

  // 公開 API 側
  await viewer.IFC.setWasmPath(wasmBaseUrl);

  if (!ifcManager) {
    throw new Error(
      "IFC loader.ifcManager が見つかりません。WASM path を内部 runtime に反映できません。",
    );
  }

  // worker を明示的に無効化
  await ifcManager.useWebWorkers?.(false);

  // manager 側にも同じ absolute URL を入れる
  await ifcManager.setWasmPath?.(wasmBaseUrl);

  // runtime API にも absolute=true で直接入れる
  const runtimeApi = ifcManager.state?.api;
  if (!runtimeApi?.SetWasmPath) {
    throw new Error(
      "IFC runtime API の SetWasmPath が見つかりません。absolute WASM path を設定できません。",
    );
  }

  runtimeApi.SetWasmPath(wasmBaseUrl, true);

  console.info("[IFC Viewer] runtime inspection", {
    hasIfcManager: Boolean(ifcManager),
    hasRuntimeApi: Boolean(runtimeApi),
    hasRuntimeSetWasmPath: Boolean(runtimeApi.SetWasmPath),
  });

  console.info("[IFC Viewer] wasmPath configured", {
    publicWasmBaseUrl: wasmBaseUrl,
    runtimeWasmPath: runtimeApi.wasmPath ?? null,
    isWasmPathAbsolute: runtimeApi.isWasmPathAbsolute ?? null,
    managerStateWasmPath: ifcManager.state?.wasmPath ?? null,
    workerActive: ifcManager.state?.worker?.active ?? null,
    workerPath: ifcManager.state?.worker?.path ?? null,
  });

  return {
    ifcManager,
    runtimeApi,
    wasmBaseUrl,
  };
}

function getIfcModelsForFraming(viewer: IfcViewerAPI): Object3D[] {
  const models = viewer.context.items.ifcModels as unknown[];
  return models.filter(
    (model): model is Object3D =>
      typeof model === "object" &&
      model !== null &&
      "position" in model &&
      "updateMatrixWorld" in model &&
      "geometry" in model,
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
  const lifecycleIdRef = useRef(0);
  const [viewerState, setViewerState] = useState<ViewerState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let active = true;
    const lifecycleId = lifecycleIdRef.current + 1;
    lifecycleIdRef.current = lifecycleId;
    let localViewer: IfcViewerAPI | null = null;
    let activeIfcManager: InternalIfcManager | null = null;

    setViewerState(modelUrl ? "loading" : "idle");
    setErrorMessage(null);

    const initializePromise = (async () => {
      try {
        const { IfcViewerAPI } = await import("web-ifc-viewer");

        if (!active || lifecycleId !== lifecycleIdRef.current) {
          return;
        }

        localViewer = new IfcViewerAPI({
          backgroundColor: new Color(0x020617),
          container,
        });
        viewerRef.current = localViewer;

        const wasmFileUrl = buildAbsoluteWasmFileUrl();
        await probeIfcWasmAsset(wasmFileUrl);
        const { ifcManager, runtimeApi, wasmBaseUrl } = await configureIfcWasmPath(localViewer);
        activeIfcManager = ifcManager;

        localViewer.axes.setAxes(2);
        localViewer.grid.setGrid(20, 20);

        if (!modelUrl) {
          if (active && lifecycleId === lifecycleIdRef.current) {
            setViewerState("ready");
          }
          return;
        }

        await ifcManager.applyWebIfcConfig?.({
          COORDINATE_TO_ORIGIN: false,
          USE_FAST_BOOLS: true,
        });

        // geometry hints の事前診断。失敗しても loadIfcUrl 自体はブロックしない。
        let geometryHintsAvailable = true;
        try {
          const geometryHints = await inspectIfcGeometryHints(modelUrl);
          console.info("[IFC Viewer] IFC geometry hints", {
            modelUrl,
            ...geometryHints,
          });
          if (!geometryHints.hasRenderableGeometryHint) {
            console.warn(
              "[IFC Viewer] IFC に表示可能な形状要素が見つかりませんでした。" +
                "空 IFC または形状未定義の可能性があります。loadIfcUrl はそのまま試行します。",
            );
            geometryHintsAvailable = false;
          }
        } catch (hintsError) {
          console.warn("[IFC Viewer] geometry hints の事前診断に失敗しました。loadIfcUrl は続行します。", hintsError);
          geometryHintsAvailable = false;
        }

        console.info("[IFC Viewer] before loadIfcUrl", {
          modelUrl,
          wasmBaseUrl,
          wasmFileUrl,
          runtimeWasmPath: runtimeApi?.wasmPath ?? null,
          isWasmPathAbsolute: runtimeApi?.isWasmPathAbsolute ?? null,
          currentIfcModelCount: localViewer.context.items.ifcModels.length,
        });

        const loadedModel = await localViewer.IFC.loadIfcUrl(modelUrl, false);
        if (!loadedModel) {
          const diagnostics = collectIfcStateDiagnostics(ifcManager);
          console.error("[IFC Viewer] loadIfcUrl returned null", {
            diagnostics,
            geometryHintsAvailable,
            modelUrl,
          });

          throw new Error(
            diagnostics.modelCount === 0 || diagnostics.modelsWithGeometry === 0
              ? "IFC の幾何生成に失敗しました。shape 情報が空、または現在の web-ifc 組み合わせで解釈できない可能性があります。"
              : "IFC モデルのロードに失敗しました。",
          );
        }

        if (!active || lifecycleId !== lifecycleIdRef.current) {
          return;
        }

        console.info("[IFC Viewer] loadIfcUrl success", {
          currentIfcModelCount: localViewer.context.items.ifcModels.length,
          modelID:
            typeof loadedModel === "object" &&
            loadedModel !== null &&
            "modelID" in loadedModel
              ? (loadedModel as { modelID?: unknown }).modelID
              : null,
        });

        await focusIfcModelsInView(localViewer);

        if (!active || lifecycleId !== lifecycleIdRef.current) {
          return;
        }

        setViewerState("ready");
      } catch (error) {
        console.error("[IFC Viewer] initialization/load failed", error);

        if (!active || lifecycleId !== lifecycleIdRef.current) {
          return;
        }

        // geometry merge error の特定: mergeBufferGeometries 内で
        // geometries[0].index を読めない場合のパターン
        const isGeometryMergeError =
          error instanceof TypeError &&
          error.message.includes("Cannot read properties of undefined") &&
          error.stack?.includes("mergeBufferGeometries");

        let userMessage: string;
        if (isGeometryMergeError) {
          userMessage =
            "IFC の幾何データ統合中にエラーが発生しました。形状要素が空、" +
            "または web-ifc が解釈できない構造の可能性があります。";
          console.error(
            "[IFC Viewer] mergeBufferGeometries crash detected — " +
              "IFC に空 geometry が含まれているか、web-ifc-three の空配列防御が不足しています。",
          );
        } else if (error instanceof Error) {
          userMessage = error.message;
        } else {
          userMessage = "IFC Viewer の初期化/読込に失敗しました。";
        }

        setViewerState("error");
        setErrorMessage(userMessage);
      }
    })();

    return () => {
      active = false;

      const cleanup = async () => {
        try {
          await initializePromise;
        } catch {
          // state 表示済み
        }

        const viewer = localViewer;
        if (!viewer) {
          return;
        }

        if (viewerRef.current === viewer) {
          viewerRef.current = null;
        }

        const diagnosticsBeforeDispose = collectIfcStateDiagnostics(activeIfcManager);
        const sanitizedModelIds = sanitizeIfcStateForDispose(activeIfcManager);
        console.info("[IFC Viewer] cleanup diagnostics", {
          diagnosticsBeforeDispose,
          sanitizedModelIds,
        });

        try {
          await viewer.dispose();
        } catch (error) {
          console.error("[IFC Viewer] dispose failed", error);
        }
      };

      void cleanup();
    };
  }, [modelUrl]);

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
