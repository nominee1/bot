// LazyYouTubeModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  videoUrl: string;      // e.g. https://youtu.be/MMQ1TCf8KfE?si=...
  isOpen: boolean;
  onClose: () => void;
};

const getYouTubeId = (url: string) => {
  // Works for youtu.be/ID, youtube.com/watch?v=ID, /embed/ID, etc.
  const m =
    url.match(/[?&]v=([^&#]+)/) ||
    url.match(/youtu\.be\/([^?&#/]+)/) ||
    url.match(/\/embed\/([^?&#/]+)/);
  return m ? m[1] : "";
};

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const frameWrap: React.CSSProperties = {
  position: "relative",
  width: "min(90vw, 960px)",
  aspectRatio: "16/9",
  background: "#000",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
};

const closeBtn: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  padding: "6px 10px",
  fontWeight: 600,
  borderRadius: 8,
  border: "none",
  cursor: "pointer",
};

export default function LazyYouTubeModal({ videoUrl, isOpen, onClose }: Props) {
  const [mountIframe, setMountIframe] = useState(false);
  const videoId = useMemo(() => getYouTubeId(videoUrl), [videoUrl]);

  // Mount the iframe only after the modal opens (user interaction happened)
  useEffect(() => {
    if (isOpen) setMountIframe(true);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Use youtube-nocookie for privacy; autoplay works because user clicked
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&modestbranding=1&rel=0`;

  return (
    <div style={backdropStyle} onClick={onClose} role="dialog" aria-modal="true">
      <div style={frameWrap} onClick={(e) => e.stopPropagation()}>
        {mountIframe ? (
          <iframe
            title="YouTube video player"
            src={src}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        ) : null}
        <button style={closeBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
