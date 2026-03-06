import type { JobAnnotations } from "@/lib/annotations";
import type { StartLevel } from "@/lib/upload";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export type JobStatus = "draft" | "queued" | "processing" | "completed" | "failed";

export type JobPlanSnapshot = {
  id: string;
  name: string;
  storey_index: number;
  pdf_url: string;
  size_label: string;
};

export type JobSnapshot = {
  id: string;
  status: JobStatus;
  progress: number;
  artifact_url: string | null;
  plan_names: string[];
  plans: JobPlanSnapshot[];
  start_level: StartLevel;
};

type CreateJobPayload = {
  plans: {
    plan_id: string;
    name: string;
    storey_index: number;
    pdf_data_base64: string;
  }[];
  start_level: StartLevel;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = "APIリクエストに失敗しました。";

    try {
      const data = (await response.json()) as { detail?: string };
      if (data.detail) {
        message = data.detail;
      }
    } catch {
      message = response.statusText || message;
    }

    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function createJob(payload: CreateJobPayload) {
  return request<JobSnapshot>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startJob(jobId: string) {
  return request<JobSnapshot>(`/api/jobs/${jobId}/start`, {
    method: "POST",
  });
}

export function getJob(jobId: string) {
  return request<JobSnapshot>(`/api/jobs/${jobId}`);
}

export function getJobAnnotations(jobId: string) {
  return request<JobAnnotations>(`/api/jobs/${jobId}/annotations`);
}

export function saveJobAnnotations(jobId: string, payload: JobAnnotations) {
  return request<JobAnnotations>(`/api/jobs/${jobId}/annotations`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
