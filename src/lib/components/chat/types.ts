export type PendingUploadPreview = {
  id: string;
  uid: string | null;
  name: string;
  size?: number;
  contentType?: string | null;
  isImage: boolean;
  previewUrl?: string | null;
  progress: number;
};
