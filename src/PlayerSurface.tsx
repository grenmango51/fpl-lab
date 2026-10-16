import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Modal } from "./components";

/** The same player tools can live below Projections or in a contextual window. */
export function PlayerSurface({
  title,
  subtitle,
  onClose,
  anchor,
  target,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  anchor: { left: number; right: number; top: number; bottom: number } | null;
  target: HTMLElement | null;
  children: ReactNode;
}) {
  const inline = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!target) return;
    const node = inline.current;
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      node?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [target]);

  if (!target)
    return (
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        wide
        className="player-window"
        anchor={anchor}
      >
        {children}
      </Modal>
    );

  return createPortal(
    <section
      ref={inline}
      className="projection-player-editor player-window"
      aria-label={`${title} player editor`}
      tabIndex={-1}
    >
      <header className="modal-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close player editor"
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </section>,
    target,
  );
}
