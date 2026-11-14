import type { Bootstrap, Week } from "../../src/types";
import type { planValidationRequest } from "../../src/planningPersistence";
export function planReceipt(
  body: ReturnType<typeof planValidationRequest>,
  forecast: Bootstrap,
): { valid: boolean; weeks: Week[] };
