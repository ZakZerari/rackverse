import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ErrorCode, Patch, Violation } from "@/lib/types";

const LESSONS_PATH = join(process.cwd(), "data", "lessons.json");

export interface Lesson {
  errorCodeSignature: ErrorCode[];
  compactContext: string;
  patch: Patch;
  improvement: string;
}

function loadLessons(): Lesson[] {
  try {
    return JSON.parse(readFileSync(LESSONS_PATH, "utf-8")) as Lesson[];
  } catch {
    return [];
  }
}

function saveLessons(lessons: Lesson[]): void {
  mkdirSync(dirname(LESSONS_PATH), { recursive: true });
  writeFileSync(LESSONS_PATH, JSON.stringify(lessons, null, 2));
}

/** Verified Repair patches, kept locally — never claimed as a Mubit feature. */
export function recordLesson(violations: Violation[], patch: Patch, improvement: string): void {
  const errorCodeSignature = [...new Set(violations.map((v) => v.code))];
  const compactContext = JSON.stringify(violations.map((v) => ({ code: v.code, message: v.message })));
  const lessons = loadLessons();
  lessons.push({ errorCodeSignature, compactContext, patch, improvement });
  saveLessons(lessons);
}

/** The top `limit` lessons whose error codes overlap most with `violations`. */
export function getRelevantLessons(violations: Violation[], limit = 3): Lesson[] {
  const codes = new Set(violations.map((v) => v.code));
  const scored = loadLessons()
    .map((lesson) => ({
      lesson,
      overlap: lesson.errorCodeSignature.filter((code) => codes.has(code)).length,
    }))
    .filter((x) => x.overlap > 0);
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, limit).map((x) => x.lesson);
}
