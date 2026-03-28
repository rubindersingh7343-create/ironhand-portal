type XhrUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type XhrUploadArgs = {
  url: string;
  file: File;
  cacheControl?: string;
  upsert?: boolean;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  onProgress?: (progress: XhrUploadProgress) => void;
  signal?: AbortSignal;
};

export async function xhrUploadFile(args: XhrUploadArgs): Promise<void> {
  const {
    url,
    file,
    onProgress,
    signal,
    method = "PUT",
    cacheControl = "3600",
    upsert = false,
    headers = {},
  } = args;

  const body = new FormData();
  body.append("cacheControl", cacheControl);
  body.append("", file);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      reject(new Error("Upload cancelled."));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.open(method, url, true);
    xhr.setRequestHeader("x-upsert", String(Boolean(upsert)));
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const loaded = event.loaded;
      const total = event.total;
      const percent =
        total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
      onProgress?.({ loaded, total, percent });
    };

    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.ontimeout = () => reject(new Error("Upload timed out."));
    xhr.onload = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      const details = xhr.responseText ? ` (${xhr.responseText.slice(0, 300)})` : "";
      reject(new Error(`Upload failed with status ${xhr.status}${details}`));
    };

    xhr.send(body);
  });
}

