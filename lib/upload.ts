export type StartLevel = "ground" | "basement" | "upper";

export type UploadedPlan = {
  id: string;
  file: File | null;
  name: string;
  pdfUrl: string;
  sizeLabel: string;
};

export const startLevelOptions: Array<{ value: StartLevel; label: string; hint: string }> = [
  {
    value: "ground",
    label: "地上階から開始",
    hint: "地上階",
  },
  {
    value: "basement",
    label: "地下階から開始",
    hint: "地下階",
  },
  {
    value: "upper",
    label: "中間階から開始",
    hint: "中間階",
  },
];

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createUploadedPlan(file: File): UploadedPlan {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    pdfUrl: URL.createObjectURL(file),
    sizeLabel: formatFileSize(file.size),
  };
}

export function createRemotePlan(input: {
  id: string;
  name: string;
  pdfUrl: string;
  sizeLabel: string;
}): UploadedPlan {
  return {
    id: input.id,
    file: null,
    name: input.name,
    pdfUrl: input.pdfUrl,
    sizeLabel: input.sizeLabel,
  };
}

export function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf");
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} の読み込みに失敗しました。`));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(`${file.name} の読み込みに失敗しました。`));
    };
    reader.readAsDataURL(file);
  });
}

export function reorderPlans(list: UploadedPlan[], fromId: string, toId: string) {
  const next = [...list];
  const fromIndex = next.findIndex((item) => item.id === fromId);
  const toIndex = next.findIndex((item) => item.id === toId);

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return list;
  }

  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
