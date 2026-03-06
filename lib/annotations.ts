export type PlanSegment = {
  id: string;
  x1_px: number;
  y1_px: number;
  x2_px: number;
  y2_px: number;
};

export type SegmentInput = Pick<PlanSegment, "x1_px" | "y1_px" | "x2_px" | "y2_px">;

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

const MIN_IMPORT_SEGMENT_LENGTH_PX = 8;
const DUPLICATE_ANGLE_TOLERANCE_DEG = 6;
const DUPLICATE_ENDPOINT_TOLERANCE_PX = 14;
const DUPLICATE_LENGTH_TOLERANCE_RATIO = 0.2;
const DUPLICATE_LENGTH_TOLERANCE_MIN_PX = 8;

function toCanonicalSegment(segment: SegmentInput): SegmentInput {
  if (segment.x1_px < segment.x2_px) {
    return segment;
  }
  if (segment.x1_px > segment.x2_px) {
    return {
      x1_px: segment.x2_px,
      y1_px: segment.y2_px,
      x2_px: segment.x1_px,
      y2_px: segment.y1_px,
    };
  }
  if (segment.y1_px <= segment.y2_px) {
    return segment;
  }
  return {
    x1_px: segment.x2_px,
    y1_px: segment.y2_px,
    x2_px: segment.x1_px,
    y2_px: segment.y1_px,
  };
}

function pointDistance(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function segmentLengthPx(segment: SegmentInput) {
  return pointDistance(segment.x1_px, segment.y1_px, segment.x2_px, segment.y2_px);
}

function segmentAngleDeg(segment: SegmentInput) {
  const angleDeg = (Math.atan2(segment.y2_px - segment.y1_px, segment.x2_px - segment.x1_px) * 180) / Math.PI;
  return angleDeg < 0 ? angleDeg + 180 : angleDeg;
}

function angleDiffDeg(left: number, right: number) {
  const diff = Math.abs(left - right);
  return Math.min(diff, 180 - diff);
}

function midpoint(segment: SegmentInput) {
  return {
    x: (segment.x1_px + segment.x2_px) * 0.5,
    y: (segment.y1_px + segment.y2_px) * 0.5,
  };
}

function isNearDuplicateSegment(
  left: SegmentInput,
  right: SegmentInput,
) {
  const leftLength = segmentLengthPx(left);
  const rightLength = segmentLengthPx(right);
  const lengthTolerance = Math.max(
    DUPLICATE_LENGTH_TOLERANCE_MIN_PX,
    Math.max(leftLength, rightLength) * DUPLICATE_LENGTH_TOLERANCE_RATIO,
  );
  if (Math.abs(leftLength - rightLength) > lengthTolerance) {
    return false;
  }

  const leftAngle = segmentAngleDeg(left);
  const rightAngle = segmentAngleDeg(right);
  if (angleDiffDeg(leftAngle, rightAngle) > DUPLICATE_ANGLE_TOLERANCE_DEG) {
    return false;
  }

  const sameOrderDistance = Math.max(
    pointDistance(left.x1_px, left.y1_px, right.x1_px, right.y1_px),
    pointDistance(left.x2_px, left.y2_px, right.x2_px, right.y2_px),
  );
  const swappedOrderDistance = Math.max(
    pointDistance(left.x1_px, left.y1_px, right.x2_px, right.y2_px),
    pointDistance(left.x2_px, left.y2_px, right.x1_px, right.y1_px),
  );
  if (Math.min(sameOrderDistance, swappedOrderDistance) <= DUPLICATE_ENDPOINT_TOLERANCE_PX) {
    return true;
  }

  const leftMidpoint = midpoint(left);
  const rightMidpoint = midpoint(right);
  return pointDistance(leftMidpoint.x, leftMidpoint.y, rightMidpoint.x, rightMidpoint.y) <= DUPLICATE_ENDPOINT_TOLERANCE_PX * 0.5;
}

export function filterUniqueSegmentsForImport(
  existingSegments: PlanSegment[],
  candidates: SegmentInput[],
) {
  const existing = existingSegments.map((segment) => toCanonicalSegment(segment));
  const accepted: SegmentInput[] = [];

  for (const candidate of candidates) {
    if (
      !Number.isFinite(candidate.x1_px) ||
      !Number.isFinite(candidate.y1_px) ||
      !Number.isFinite(candidate.x2_px) ||
      !Number.isFinite(candidate.y2_px)
    ) {
      continue;
    }

    const normalized = toCanonicalSegment(candidate);
    if (segmentLengthPx(normalized) < MIN_IMPORT_SEGMENT_LENGTH_PX) {
      continue;
    }

    if (existing.some((segment) => isNearDuplicateSegment(segment, normalized))) {
      continue;
    }
    if (accepted.some((segment) => isNearDuplicateSegment(segment, normalized))) {
      continue;
    }

    accepted.push(normalized);
  }

  return accepted;
}
