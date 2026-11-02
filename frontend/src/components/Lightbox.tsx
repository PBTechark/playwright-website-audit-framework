import { useEffect } from 'react';

export interface LightboxImage {
  src: string;
  downloadHref: string;
  caption: string;
}

/** Full-size screenshot viewer with download; Escape or the backdrop closes it. */
export function Lightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  useEffect(() => {
    if (!image) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.caption}
      className="fixed inset-0 z-50 flex flex-col bg-[#0b111c]/95 p-4 sm:p-6"
      onClick={onClose}
    >
      <div className="mb-4 flex items-center justify-between gap-3 text-white" onClick={(event) => event.stopPropagation()}>
        <span className="min-w-0 truncate font-semibold">{image.caption}</span>
        <div className="flex shrink-0 gap-2">
          <a className="btn bg-white/10 text-white hover:bg-white/20" href={image.downloadHref}>
            Download
          </a>
          <button type="button" className="btn bg-white/10 text-white hover:bg-white/20" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" onClick={(event) => event.stopPropagation()}>
        <img src={image.src} alt={image.caption} className="mx-auto max-w-full" />
      </div>
    </div>
  );
}
