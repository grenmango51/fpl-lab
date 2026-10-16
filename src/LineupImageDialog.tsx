import { useEffect, useState } from "react";
import { Modal } from "./components";
import { createLineupImage } from "./lineupImage";
import type { Bootstrap, Plan, Week } from "./types";

export function LineupImageDialog({
  data,
  plan,
  week,
  onClose,
}: {
  data: Bootstrap;
  plan: Plan;
  week: Week;
  onClose: () => void;
}) {
  const [url, setURL] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setURL("");
    setError("");
    createLineupImage(data, plan, week)
      .then((imageURL) => {
        if (cancelled) return;
        setURL(imageURL);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [data, plan, week]);

  return (
    <Modal
      title={`GW${week.gw} lineup image`}
      onClose={onClose}
      className="lineup-image-dialog"
    >
      <div className="modal-body">
        {error ? (
          <p role="alert">{error}</p>
        ) : url ? (
          <>
            <a
              className="button primary"
              href={url}
              download={`open-fpl-gw${week.gw}.png`}
            >
              Save PNG
            </a>
            <img
              src={url}
              alt={`GW${week.gw} lineup with captain, bench and forecasts`}
            />
          </>
        ) : (
          <p role="status">Creating image…</p>
        )}
      </div>
    </Modal>
  );
}
