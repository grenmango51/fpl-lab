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
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!target) return;
    const node = inline.current;
    return () => {
      const active = document.activeElement;
      if (
        opener.current?.isConnected &&
        (!active ||
          active === document.body ||
          (inline.current ?? node)?.contains(active))
      ) {
        opener.current.focus({ preventScroll: true });
      }
      opener.current = null;
    };
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && !inline.current?.contains(active)) {
      opener.current = active;
    }
    const frame = requestAnimationFrame(() => {
      const node = inline.current;
      if (!node) return;
      node.scrollIntoView?.({ block: "nearest" });
      if (!node.contains(document.activeElement)) {
        node.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [target, title, subtitle]);

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
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="modal-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button
          type="button"
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
