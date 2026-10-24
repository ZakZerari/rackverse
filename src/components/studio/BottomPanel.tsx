"use client";

import { useRackStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function BottomPanel() {
  const violations = useRackStore((s) => s.violations);
  const hardCount = violations.filter((v) => v.severity === "hard").length;
  const softCount = violations.length - hardCount;

  return (
    <div className="flex h-full flex-col border-t border-border">
      <Tabs defaultValue="checks" className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <TabsList>
            <TabsTrigger value="checks">
              Engineering Checks
              {violations.length > 0 && (
                <Badge variant={hardCount > 0 ? "destructive" : "secondary"} className="ml-1.5">
                  {violations.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity">Agent Activity</TabsTrigger>
          </TabsList>
          {violations.length === 0 && (
            <span className="text-xs text-emerald-500">✓ All checks passing</span>
          )}
        </div>

        <TabsContent value="checks" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="divide-y divide-border">
              {violations.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">
                  No violations. Add equipment to the rack to see live engineering checks here.
                </p>
              ) : (
                violations.map((v, i) => (
                  <div key={`${v.code}-${i}`} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <Badge variant={v.severity === "hard" ? "destructive" : "outline"} className="mt-0.5 shrink-0">
                      {v.severity}
                    </Badge>
                    <div>
                      <p className="font-mono text-[11px] text-foreground">{v.code}</p>
                      <p className="text-muted-foreground">{v.message}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="activity" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <p className="p-3 text-xs text-muted-foreground">
              Agent calls will appear here once the Copilot and Repair Agent are wired up.
            </p>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      {softCount > 0 && hardCount === 0 && (
        <p className="sr-only">{softCount} soft warning(s)</p>
      )}
    </div>
  );
}
