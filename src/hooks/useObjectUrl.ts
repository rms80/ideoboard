import { useEffect, useState } from "react";
import { getImageObjectURL, getThumbnailObjectURL } from "../services/images";

/**
 * Resolve an IndexedDB-stored image/thumbnail to an object URL for <img>.
 * URLs are cached + revoked centrally (on scene switch), so we don't revoke here.
 */
export function useObjectUrl(
  id: string | undefined,
  kind: "image" | "thumb" = "image"
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!id) {
      setUrl(undefined);
      return;
    }
    const fn = kind === "image" ? getImageObjectURL : getThumbnailObjectURL;
    fn(id).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [id, kind]);
  return url;
}
