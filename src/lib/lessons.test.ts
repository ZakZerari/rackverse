import { describe, expect, it } from "vitest";
import { renderLessonsForPrompt, selectRelevantLessons, type Lesson } from "@/lib/lessons";
import type { Violation } from "@/lib/types";

function lesson(codes: Lesson["errorCodeSignature"], patch: Lesson["patch"]): Lesson {
  return { errorCodeSignature: codes, compactContext: "x".repeat(400), patch, improvement: "y".repeat(120) };
}

function violation(code: Violation["code"]): Violation {
  return { code, severity: "hard", message: "m", placementIds: [] };
}

describe("selectRelevantLessons", () => {
  it("ranks by how many error codes overlap", () => {
    const both = lesson(["RACK_OVERLAP", "WEIGHT_EXCEEDED"], { ops: [], rationale: "" });
    const one = lesson(["RACK_OVERLAP"], { ops: [], rationale: "" });
    const none = lesson(["BUDGET_EXCEEDED"], { ops: [], rationale: "" });

    const picked = selectRelevantLessons(
      [none, one, both],
      [violation("RACK_OVERLAP"), violation("WEIGHT_EXCEEDED")]
    );

    expect(picked[0]).toBe(both);
    expect(picked).not.toContain(none);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 10 }, () => lesson(["RACK_OVERLAP"], { ops: [], rationale: "" }));
    expect(selectRelevantLessons(many, [violation("RACK_OVERLAP")], 3)).toHaveLength(3);
  });
});

describe("renderLessonsForPrompt", () => {
  it("renders the fix shape, not the whole record", () => {
    const rendered = renderLessonsForPrompt([
      lesson(["RACK_OUT_OF_BOUNDS"], {
        ops: [{ op: "move", placementId: "p1", newStartU: 9 }],
        rationale: "irrelevant prose",
      }),
    ]);

    expect(rendered).toContain("RACK_OUT_OF_BOUNDS");
    expect(rendered).toContain("move →U9");
    // The bulky parts are what made this the largest chunk of the prompt.
    expect(rendered).not.toContain("irrelevant prose");
    expect(rendered).not.toContain("xxxx");
  });

  it("covers every op kind", () => {
    const rendered = renderLessonsForPrompt([
      lesson(["PDU_OUTLETS_INSUFFICIENT"], {
        ops: [
          { op: "add", catalogId: "apc-ap7868", startU: 1, face: "rear", feed: "A" },
          { op: "remove", placementId: "p2" },
          { op: "replace", placementId: "p3", newCatalogId: "dell-poweredge-r640" },
        ],
        rationale: "",
      }),
    ]);

    expect(rendered).toContain("add apc-ap7868@U1/rear/feedA");
    expect(rendered).toContain("remove");
    expect(rendered).toContain("replace →dell-poweredge-r640");
  });

  it("is dramatically smaller than the raw JSON it replaces", () => {
    const lessons = Array.from({ length: 3 }, () =>
      lesson(["RACK_OVERLAP"], { ops: [{ op: "move", placementId: "p1", newStartU: 4 }], rationale: "z".repeat(200) })
    );
    expect(renderLessonsForPrompt(lessons).length).toBeLessThan(JSON.stringify(lessons).length / 4);
  });

  it("says so plainly when there's nothing learned yet", () => {
    expect(renderLessonsForPrompt([])).toBe("none");
  });
});
