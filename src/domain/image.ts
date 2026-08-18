export interface LotImage {
  id: number;
  lotId: number;
  sourceUrl: string;
  localPath: string | null;
  imageOrder: number;
  width: number | null;
  height: number | null;
  downloadedAt: string | null;
}

export type AcquisitionMethod = "http" | "browser" | "local-file";
export type AcquisitionStatus = "success" | "blocked" | "failed" | "unsupported";

export interface AcquisitionRun {
  id: number;
  url: string;
  startedAt: string;
  completedAt: string | null;
  status: AcquisitionStatus;
  acquisitionMethod: AcquisitionMethod;
  errorMessage: string | null;
  rawFilePath: string | null;
}
