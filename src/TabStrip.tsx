import { useEffect, useRef, type ReactNode } from "react";

export function TabStrip<T extends string>({
  label,
  value,
  items,
  onChange,
  className = "segmented",
}: {
  label: string;
  value: T;
  items: readonly { id: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.id === value),
  );
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reveal = () => {
      const active = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return;
      const bounds = node.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const inset = 12;
      if (item.left < bounds.left + inset)
        node.scrollLeft += item.left - (bounds.left + inset);
      else if (item.right > bounds.right - inset)
        node.scrollLeft += item.right - (bounds.right - inset);
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div
      ref={root}
      className={`${className} tab-strip`}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={value === item.id}
          tabIndex={index === activeIndex ? 0 : -1}
          className={value === item.id ? "active nav-active" : ""}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % items.length
                : event.key === "ArrowLeft"
                  ? (index - 1 + items.length) % items.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(items[next].id);
            root.current
              ?.querySelectorAll<HTMLButtonElement>("button")
              [next]?.focus({ preventScroll: true });
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
