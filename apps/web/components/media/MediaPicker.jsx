"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, MoreHorizontal, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { appendMediaPage, formatMediaSize, isLargeMedia } from "@/lib/media/library";

const MediaPickerContext = createContext(null);

// Opens the workspace image library and resolves with the chosen image, or null.
export function MediaPickerProvider({ children }) {
  const [request, setRequest] = useState(null);
  const openMediaPicker = useCallback(
    () =>
      new Promise((resolve) => {
        setRequest((current) => {
          current?.resolve(null);
          return { resolve };
        });
      }),
    [],
  );
  const close = useCallback((item) => {
    setRequest((current) => {
      current?.resolve(item || null);
      return null;
    });
  }, []);
  return (
    <MediaPickerContext.Provider value={openMediaPicker}>
      {children}
      {request ? <MediaPickerDialog onClose={close} /> : null}
    </MediaPickerContext.Provider>
  );
}

export function useMediaPicker() {
  const openMediaPicker = useContext(MediaPickerContext);
  if (!openMediaPicker) throw new Error("useMediaPicker must be used inside MediaPickerProvider.");
  return openMediaPicker;
}

async function readJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || fallback);
  return payload;
}

function MediaPickerDialog({ onClose }) {
  const fileInputRef = useRef(null);
  const [items, setItems] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/media", { credentials: "include" })
      .then((response) => readJson(response, "Could not load images."))
      .then((page) => {
        if (cancelled) return;
        setItems(page.items || []);
        setNextBefore(page.next_before || null);
      })
      .catch((error) => toast.error(error.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await readJson(
        await fetch(`/api/media?before=${encodeURIComponent(nextBefore)}`, { credentials: "include" }),
        "Could not load images.",
      );
      setItems((shown) => appendMediaPage(shown, page.items || []));
      setNextBefore(page.next_before || null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.some((file) => isLargeMedia(file.size))) {
      toast.warning("Large images load slowly in email. Images under 1 MB work best.");
    }
    setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const item = await readJson(
          await fetch("/api/media", { method: "POST", body: formData, credentials: "include" }),
          "Could not upload image.",
        );
        setItems((shown) => [item, ...shown.filter((entry) => entry.id !== item.id)]);
        setSelectedId(item.id);
      } catch (error) {
        toast.error(`${file.name}: ${error.message}`);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  };

  const hideImage = async (item) => {
    try {
      await readJson(
        await fetch(`/api/media/${item.id}`, { method: "DELETE", credentials: "include" }),
        "Could not delete image.",
      );
      setItems((shown) => shown.filter((entry) => entry.id !== item.id));
      if (selectedId === item.id) setSelectedId(null);
    } catch (error) {
      toast.error(error.message);
    }
  };

  const selected = items.find((item) => item.id === selectedId) || null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(null)}>
      <DialogContent
        className="flex max-h-[85vh] max-w-3xl flex-col gap-4"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          uploadFiles(event.dataTransfer?.files);
        }}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 space-y-0 pr-8">
          <div className="space-y-1">
            <DialogTitle>Choose an image</DialogTitle>
            <DialogDescription>Images you upload are saved to your library and can be reused in any email.</DialogDescription>
          </div>
          <Button type="button" size="sm" className="h-8 shrink-0" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1.5 size-3.5" />
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            multiple
            className="hidden"
            onChange={(event) => {
              uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </DialogHeader>

        <div
          className={cn(
            "min-h-[280px] flex-1 overflow-y-auto rounded-lg border border-dashed border-transparent",
            dragging && "border-primary/50 bg-primary/5",
          )}
        >
          {loading ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading images…
            </div>
          ) : items.length === 0 && uploading === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-[280px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40"
            >
              <ImagePlus className="size-6" />
              <span>No images yet. Upload your logo or other images to use them in your emails.</span>
              <span className="text-xs">PNG, JPG or GIF, up to 5 MB. You can also drop files here.</span>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: uploading }).map((_, index) => (
                <div
                  key={`uploading-${index}`}
                  className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/40"
                >
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ))}
              {items.map((item) => (
                <div key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    onDoubleClick={() => onClose(item)}
                    className={cn(
                      "flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#f4f4f5_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px] p-2",
                      selectedId === item.id ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-foreground/30",
                    )}
                    aria-pressed={selectedId === item.id}
                    aria-label={item.file_name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  </button>
                  <div className="mt-1.5 min-w-0 pr-7">
                    <p className="truncate text-xs font-medium text-foreground">{item.file_name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.width && item.height ? `${item.width} × ${item.height} · ` : ""}
                      {formatMediaSize(item.size_bytes)}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`More actions for ${item.file_name}`}
                        className="absolute bottom-1 right-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-destructive" onSelect={() => hideImage(item)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
          {nextBefore ? (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(null)}>
            Cancel
          </Button>
          <Button type="button" disabled={!selected} onClick={() => onClose(selected)}>
            Use image
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
