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
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const reveal = () => {
      const active = node.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active) return;
      const bounds = node.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) node.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right)
        node.scrollLeft += item.right - bounds.right;
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
          tabIndex={value === item.id ? 0 : -1}
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
