import { existsSync } from "node:fs";
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
} from "node:worker_threads";

const receipts = new Map();
let bridge;
let nextRequestId = 0;

function ensureBridge() {
  if (bridge) return bridge;
  const python =
    process.env.FPL_TEST_PYTHON ||
    (existsSync(".venv/bin/python")
      ? ".venv/bin/python"
      : existsSync(".venv/Scripts/python.exe")
        ? ".venv/Scripts/python.exe"
        : "python");
  const worker = new Worker(
    `
    const { spawn } = require("node:child_process");
    const { createInterface } = require("node:readline");
    const { parentPort, workerData } = require("node:worker_threads");

    let child;
    let stderr = "";
    const pending = new Map();

    function failAll(reason) {
      for (const [id, item] of pending) {
        pending.delete(id);
        item.port.postMessage({ error: reason });
        Atomics.store(item.signal, 0, 1);
        Atomics.notify(item.signal, 0);
        item.port.close();
      }
    }

    function start() {
      stderr = "";
      child = spawn(
        workerData.python,
        ["-X", "utf8", "-u", "-m", "tools.tests.plan_receipt"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      child.unref();
      child.stdin.on("error", () => {});
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          failAll(String(error));
          return;
        }
        const item = pending.get(parsed.id);
        if (!item) return;
        pending.delete(parsed.id);
        item.port.postMessage({ result: parsed });
        Atomics.store(item.signal, 0, 1);
        Atomics.notify(item.signal, 0);
        item.port.close();
      });
      child.on("exit", (code) => {
        child = null;
        failAll(stderr.trim() || \`plan_receipt exited with code \${code}\`);
      });
      child.on("error", (error) => {
        child = null;
        failAll(String(error));
      });
    }

    parentPort.on("message", (msg) => {
      if (msg.cancel !== undefined) {
        const stale = pending.get(msg.cancel);
        if (stale) {
          pending.delete(msg.cancel);
          stale.port.close();
        }
        return;
      }
      if (!child) start();
      const signal = new Int32Array(msg.sab);
      pending.set(msg.id, { port: msg.port, signal });
      child.stdin.write(msg.payload + "\\n");
    });
    parentPort.on("close", () => {
      if (child) {
        try { child.stdin.end(); } catch {}
        child.kill();
      }
    });
    `,
    { eval: true, workerData: { python } },
  );
  worker.unref();
  bridge = worker;
  return bridge;
}

export function planReceipt(body, forecast) {
  const key = JSON.stringify({ body, forecast });
  const cached = receipts.get(key);
  if (cached) {
    if (cached.status !== 200)
      throw new Error(JSON.stringify(cached.body.detail));
    return structuredClone(cached.body);
  }
  const id = ++nextRequestId;
  const payload = JSON.stringify({ id, body, forecast });
  const { port1, port2 } = new MessageChannel();
  const sab = new SharedArrayBuffer(4);
  const signal = new Int32Array(sab);
  const worker = ensureBridge();
  worker.postMessage({ id, payload, sab, port: port2 }, [port2]);
  const wait = Atomics.wait(signal, 0, 0, 120000);
  const message = receiveMessageOnPort(port1)?.message;
  port1.close();
  if (wait === "timed-out" || !message) {
    worker.postMessage({ cancel: id });
    throw new Error("Timed out waiting for in-process /api/plan/validate receipt.");
  }
  if (message.error) throw new Error(message.error);
  const result = message.result;
  receipts.set(key, result);
  if (result.status !== 200)
    throw new Error(JSON.stringify(result.body.detail));
  return structuredClone(result.body);
}
