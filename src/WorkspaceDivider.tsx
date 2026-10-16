export function WorkspaceDivider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div
      className="workspace-divider"
      role="separator"
      tabIndex={0}
      aria-label="Resize planner panels"
      aria-orientation="vertical"
      aria-valuemin={25}
      aria-valuemax={70}
      aria-valuenow={value}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onChange(
            Math.max(
              25,
              Math.min(70, value + (event.key === "ArrowLeft" ? -2 : 2)),
            ),
          );
        }
        if (event.key === "Home") onChange(50);
      }}
      onDoubleClick={() => onChange(50)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add("dragging");
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const box = event.currentTarget.parentElement!.getBoundingClientRect();
        onChange(
          Math.max(
            25,
            Math.min(
              70,
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
