import { useEffect, useState } from "react";

// View preferences belong to the tab; saved squads and forecasts have their own store.
export function useViewState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem(`open-fpl-view:${key}`) ?? "null") ??
        fallback
      );
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    sessionStorage.setItem(`open-fpl-view:${key}`, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
