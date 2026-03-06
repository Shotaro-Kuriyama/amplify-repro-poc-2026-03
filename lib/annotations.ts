export type PlanSegment = {
  id: string;
  x1_px: number;
  y1_px: number;
  x2_px: number;
  y2_px: number;
};

export type PlanAnnotations = {
  plan_id: string;
  plan_name: string;
  storey_index: number;
  px_to_m: number | null;
  wall_height_m: number;
  wall_thickness_m: number;
  segments: PlanSegment[];
};

export type JobAnnotations = {
  plans: PlanAnnotations[];
};

export function createDefaultPlanAnnotations(
  planId: string,
  planName: string,
  storeyIndex: number,
): PlanAnnotations {
  return {
    plan_id: planId,
    plan_name: planName,
    storey_index: storeyIndex,
    px_to_m: null,
    wall_height_m: 2.4,
    wall_thickness_m: 0.12,
    segments: [],
  };
}

export function upsertPlanAnnotations(
  annotations: JobAnnotations,
  nextPlan: PlanAnnotations,
): JobAnnotations {
  const filtered = annotations.plans.filter((plan) => plan.plan_id !== nextPlan.plan_id);
  return {
    plans: [...filtered, nextPlan].sort((left, right) => left.storey_index - right.storey_index),
  };
}

export function getPlanAnnotations(
  annotations: JobAnnotations,
  planId: string,
): PlanAnnotations | null {
  return annotations.plans.find((plan) => plan.plan_id === planId) ?? null;
}
