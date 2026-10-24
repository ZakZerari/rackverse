import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { RunEvent } from "@/lib/events";

const mocks = vi.hoisted(() => ({ create: vi.fn(), append: vi.fn() }));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mocks.create } };
  },
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  appendFileSync: mocks.append,
}));

import { complete, MUBIT_TASK_MODEL } from "@/lib/llm";

afterEach(() => {
  mocks.create.mockReset();
  mocks.append.mockReset();
});

describe("Mubit provider capacity recovery", () => {
  it("retries a 503 with the same task identity and shows progress instead of a raw error", async () => {
    const priorKey = process.env.MUBIT_API_KEY;
    const priorModel = process.env.MUBIT_MODEL;
    process.env.MUBIT_API_KEY = "mbt_test_only";
    process.env.MUBIT_MODEL = MUBIT_TASK_MODEL;

    try {
      const unavailable = Object.assign(new Error('503 [{"error":{"status":"UNAVAILABLE"}}]'), {
        status: 503,
        headers: new Headers({ "retry-after": "0", "x-middleware-request-id": `mreq_${"a".repeat(32)}` }),
      });
      mocks.create
        .mockReturnValueOnce({ withResponse: () => Promise.reject(unavailable) })
        .mockReturnValueOnce({ withResponse: async () => ({
          data: { async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { content: '{"ok":true}' } }] }; } },
          response: new Response(null, { headers: { "x-middleware-request-id": `mreq_${"b".repeat(32)}` } }),
        }) });

      const events: RunEvent[] = [];
      const result = await complete({
        agent: "RackEditor",
        system: "Stable edit instructions",
        user: "Edit rack A",
        schema: z.object({ ok: z.boolean() }),
        emit: (event) => events.push(event),
      });

      expect(result).toEqual({ ok: true });
      expect(mocks.create).toHaveBeenCalledTimes(2);
      const first = mocks.create.mock.calls[0][0];
      const second = mocks.create.mock.calls[1][0];
      expect(second.model).toBe(MUBIT_TASK_MODEL);
      expect(second.messages[0]).toEqual(first.messages[0]);
      expect(second.response_format).toEqual(first.response_format);
      expect(events.filter((event) => event.type === "agent:start")).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ type: "agent:retry", agent: "RackEditor" }));
      expect(events.some((event) => event.type === "agent:error")).toBe(false);
      expect(events.at(-1)).toMatchObject({ type: "agent:done", agent: "RackEditor" });
      expect(mocks.append).toHaveBeenCalledTimes(2);
      const loggedKeys = mocks.append.mock.calls.map((call) => JSON.parse(String(call[1])).taskKey);
      expect(loggedKeys[0]).toMatch(/^[a-f0-9]{16}$/);
      expect(loggedKeys[0]).toBe(loggedKeys[1]);
    } finally {
      if (priorKey === undefined) delete process.env.MUBIT_API_KEY;
      else process.env.MUBIT_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.MUBIT_MODEL;
      else process.env.MUBIT_MODEL = priorModel;
    }
  });

  it("ends an extended 503 outage with one clear error after bounded retries", async () => {
    const priorKey = process.env.MUBIT_API_KEY;
    const priorModel = process.env.MUBIT_MODEL;
    process.env.MUBIT_API_KEY = "mbt_test_only";
    process.env.MUBIT_MODEL = MUBIT_TASK_MODEL;
    try {
      const unavailable = Object.assign(new Error('503 [{"error":{"message":"high demand"}}]'), {
        status: 503,
        headers: new Headers({ "retry-after": "0" }),
      });
      mocks.create.mockImplementation(() => ({ withResponse: () => Promise.reject(unavailable) }));
      const events: RunEvent[] = [];

      await expect(complete({
        agent: "RackEditor",
        system: "Stable edit instructions",
        user: "Edit rack B",
        schema: z.object({ ok: z.boolean() }),
        emit: (event) => events.push(event),
      })).rejects.toThrow("The model service is temporarily busy");

      expect(mocks.create).toHaveBeenCalledTimes(5);
      expect(events.filter((event) => event.type === "agent:start")).toHaveLength(1);
      expect(events.filter((event) => event.type === "agent:error")).toEqual([
        expect.objectContaining({ agent: "RackEditor", attempt: 5, error: expect.not.stringContaining("503 [") }),
      ]);
    } finally {
      if (priorKey === undefined) delete process.env.MUBIT_API_KEY;
      else process.env.MUBIT_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.MUBIT_MODEL;
      else process.env.MUBIT_MODEL = priorModel;
    }
  });

  it("keeps smoke tests out of task training and forbids production opt-out", async () => {
    const priorKey = process.env.MUBIT_API_KEY;
    const priorModel = process.env.MUBIT_MODEL;
    process.env.MUBIT_API_KEY = "mbt_test_only";
    process.env.MUBIT_MODEL = MUBIT_TASK_MODEL;
    try {
      mocks.create.mockReturnValue({ withResponse: async () => ({
        data: { async *[Symbol.asyncIterator]() { yield { choices: [{ delta: { content: '{"ok":true}' } }] }; } },
        response: new Response(null),
      }) });
      const schema = z.object({ ok: z.boolean() });
      await complete({ agent: "SmokeTest", system: "Connectivity check", user: "ping", schema, recordForTraining: false });
      expect(mocks.create.mock.calls[0][1]).toEqual({ headers: { "x-middleware-record": "off" } });
      await expect(complete({ agent: "RackEditor", system: "Edit", user: "rack", schema, recordForTraining: false }))
        .rejects.toThrow(/Only the connectivity smoke test/);
      expect(mocks.create).toHaveBeenCalledTimes(1);
    } finally {
      if (priorKey === undefined) delete process.env.MUBIT_API_KEY;
      else process.env.MUBIT_API_KEY = priorKey;
      if (priorModel === undefined) delete process.env.MUBIT_MODEL;
      else process.env.MUBIT_MODEL = priorModel;
    }
  });
});
