"use client";

import { useRackStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function VersionHistoryPanel() {
  const versions = useRackStore((s) => s.versions);
  const currentVersion = useRackStore((s) => s.design.version);
  const restoreVersion = useRackStore((s) => s.restoreVersion);

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        Version History
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Version History</SheetTitle>
          <SheetDescription>
            Every committed change to this design. Restoring an older version commits it again
            as the new latest version.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 px-4">
          <div className="space-y-2 pb-4">
            {[...versions].reverse().map((v) => (
              <div
                key={v.version}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">Version {v.version}</p>
                  <p className="text-xs text-muted-foreground">
                    {v.placements.length} placement(s)
                  </p>
                </div>
                {v.version === currentVersion ? (
                  <span className="text-xs text-muted-foreground">current</span>
                ) : (
                  <Button variant="outline" size="xs" onClick={() => restoreVersion(v.version)}>
                    Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
