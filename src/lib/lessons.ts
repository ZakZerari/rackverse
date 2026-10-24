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

function toLesson(violations: Violation[], patch: Patch, improvement: string): Lesson {
  return {
    errorCodeSignature: [...new Set(violations.map((v) => v.code))],
    compactContext: JSON.stringify(violations.map((v) => ({ code: v.code, message: v.message }))),
    patch,
    improvement,
  };
}

/** The top `limit` of `lessons` whose error codes overlap most with `violations`. Pure. */
export function selectRelevantLessons(lessons: Lesson[], violations: Violation[], limit = 3): Lesson[] {
  const codes = new Set(violations.map((v) => v.code));
  const scored = lessons
    .map((lesson) => ({ lesson, overlap: lesson.errorCodeSignature.filter((code) => codes.has(code)).length }))
    .filter((x) => x.overlap > 0);
  scored.sort((a, b) => b.overlap - a.overlap);
  return scored.slice(0, limit).map((x) => x.lesson);
}

/** Verified Repair patches, kept locally in data/lessons.json — never claimed as a Mubit feature. */
export function recordLesson(violations: Violation[], patch: Patch, improvement: string): void {
  saveLessons([...loadLessons(), toLesson(violations, patch, improvement)]);
}

/** Relevant lessons from the shared, file-backed store — what the live Studio app uses. */
export function getRelevantLessons(violations: Violation[], limit = 3): Lesson[] {
  return selectRelevantLessons(loadLessons(), violations, limit);
}

/** How many lessons the live app has verified and kept, for the Lab page. */
export function countStoredLessons(): number {
  return loadLessons().length;
}

/**
 * An isolated, in-memory lesson store — for the benchmark, which needs
 * Config A (no lessons) vs. Config B (lessons learned only from train seeds)
 * without reading or writing the shared data/lessons.json.
 */
export function createInMemoryLessonStore() {
  let lessons: Lesson[] = [];
  return {
    getRelevantLessons: (violations: Violation[], limit = 3) => selectRelevantLessons(lessons, violations, limit),
    recordLesson: (violations: Violation[], patch: Patch, improvement: string) => {
      lessons = [...lessons, toLesson(violations, patch, improvement)];
    },
    size: () => lessons.length,
  };
}
