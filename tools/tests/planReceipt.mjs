import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const receipts = new Map();
export function planReceipt(body, forecast) {
  const key = JSON.stringify({ body, forecast });
  const cached = receipts.get(key);
  if (cached) {
    if (cached.status !== 200)
      throw new Error(JSON.stringify(cached.body.detail));
    return structuredClone(cached.body);
  }
  const python =
    process.env.FPL_TEST_PYTHON ||
    (existsSync(".venv/bin/python")
      ? ".venv/bin/python"
      : existsSync(".venv/Scripts/python.exe")
        ? ".venv/Scripts/python.exe"
        : "python");
  const result = JSON.parse(
    execFileSync(python, ["-m", "tools.tests.plan_receipt"], {
      input: key,
      encoding: "utf8",
      timeout: 15000,
    }),
  );
  receipts.set(key, result);
  if (result.status !== 200)
    throw new Error(JSON.stringify(result.body.detail));
  return structuredClone(result.body);
}
