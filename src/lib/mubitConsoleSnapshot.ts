/** A dated, user-provided console observation; not a live Mubit API response. */
export interface MubitConsoleSnapshot {
  capturedAt: string;
  source: string;
  consoleUrl: string;
  tasksTotal: number;
  liveTasks: number;
  learningTasks: number;
  tasks: { name: string; status: string; calls7d: number; kept: number | null; needed: number }[];
  adapter: {
    task: string;
    baseModel: string;
    version: string;
    status: string;
    qualityPct: number;
    targetPct: number;
    testCases: number;
    requestsServed: number | null;
    latencyMs: number | null;
    tokenCost: number | null;
  };
}
