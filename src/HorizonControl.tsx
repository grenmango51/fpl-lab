import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";

export function HorizonControl({
  value,
  max,
  start,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  start: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const committed = useRef(value);
  const id = useId();
  useEffect(() => {
    if (disabled) return;
    setDraft(value);
    committed.current = value;
  }, [value, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function commit(count: number) {
    if (disabled || count === committed.current) return;
    committed.current = count;
    onChange(count);
  }
  return (
    <div
      className="horizon-control"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          root.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        aria-label="Planning horizon"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <CalendarDays size={14} />
        {value} {value === 1 ? "GW" : "GWs"}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="horizon-popover"
          role="dialog"
          aria-label="Planning horizon"
          id={id}
        >
          <div>
            <label htmlFor={`${id}-range`}>Gameweeks</label>
            <output>{draft}</output>
          </div>
          <input
            id={`${id}-range`}
            aria-label="Gameweeks in plan"
            type="range"
            min={1}
            max={max}
            value={draft}
            aria-disabled={disabled}
            aria-busy={disabled}
            autoFocus
            onChange={(event) => {
              if (!disabled) setDraft(+event.target.value);
            }}
            onKeyDown={(event) => {
              if (disabled && event.key !== "Tab" && event.key !== "Escape")
                event.preventDefault();
            }}
            onPointerDown={(event) => {
              if (disabled) event.preventDefault();
            }}
            onPointerUp={(event) => commit(+event.currentTarget.value)}
            onKeyUp={(event) => {
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                  "Home",
                  "End",
                  "PageUp",
                  "PageDown",
                ].includes(event.key)
              )
                commit(+event.currentTarget.value);
            }}
            onBlur={(event) => commit(+event.currentTarget.value)}
          />
          <div className="horizon-limits">
            <span>GW{start}</span>
            <span>GW{start + draft - 1}</span>
          </div>
        </div>
      )}
    </div>
  );
}
