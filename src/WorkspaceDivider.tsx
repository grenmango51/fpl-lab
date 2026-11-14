import { useEffect, useRef, useState } from "react";

export function computeSplitBounds(
  containerWidth: number,
  viewportWidth: number,
): [number, number] {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return [25, 70];
  const minLeft = viewportWidth <= 1050 ? 220 : 280;
  const maxLeft = Math.max(minLeft, containerWidth - 366);
  const min = Math.min(
    70,
    Math.max(25, Math.ceil((minLeft * 100) / containerWidth - 1e-9)),
  );
  const max = Math.max(
    min,
    Math.min(70, Math.floor((maxLeft * 100) / containerWidth + 1e-9)),
  );
  return [min, max];
}

export function nextSplitForKey(
  key: string,
  currentValue: number,
  [low, high]: [number, number],
): number | null {
  const clamp = (next: number) => Math.max(low, Math.min(high, next));
  const now = clamp(currentValue);
  if (key === "ArrowLeft") return clamp(now - 2);
  if (key === "ArrowRight") return clamp(now + 2);
  if (key === "Home") return low;
  if (key === "End") return high;
  if (key === "Enter") return clamp(50);
  return null;
}

export function WorkspaceDivider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<[number, number]>([25, 70]);

  const readBounds = (element: HTMLDivElement | null): [number, number] => {
    if (typeof window === "undefined" || !element?.parentElement)
      return [25, 70];
    return computeSplitBounds(
      element.parentElement.getBoundingClientRect().width,
      window.innerWidth,
    );
  };

  useEffect(() => {
    const sync = () => setBounds(readBounds(ref.current));
    sync();
    if (typeof window === "undefined") return;
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const [min, max] = bounds;
  const clampedNow = Math.max(min, Math.min(max, value));

  return (
    <div
      ref={ref}
      className="workspace-divider"
      role="separator"
      tabIndex={0}
      title="Drag to resize · Double-click or Enter to reset"
      aria-label="Resize planner panels"
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clampedNow}
      onKeyDown={(event) => {
        const currentBounds = readBounds(event.currentTarget);
        setBounds(currentBounds);
        const next = nextSplitForKey(event.key, value, currentBounds);
        if (next !== null) {
          event.preventDefault();
          onChange(next);
        }
      }}
      onDoubleClick={(event) => {
        const [low, high] = readBounds(event.currentTarget);
        setBounds([low, high]);
        onChange(Math.max(low, Math.min(high, 50)));
      }}
      onPointerDown={(event) => {
        setBounds(readBounds(event.currentTarget));
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add("dragging");
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        const box = parent.getBoundingClientRect();
        if (box.width <= 0) return;
        const [low, high] = computeSplitBounds(box.width, window.innerWidth);
        setBounds([low, high]);
        onChange(
          Math.max(
            low,
            Math.min(
              high,
              Math.round(((event.clientX - box.left) / box.width) * 100),
            ),
          ),
        );
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        event.currentTarget.classList.remove("dragging");
      }}
      onPointerCancel={(event) =>
        event.currentTarget.classList.remove("dragging")
      }
    >
      <span />
    </div>
  );
}
