"use client";

import { useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { MultiShotEditor } from "./multi-shot-editor";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

export function GeneratorMultiShotSection() {
  const [open, setOpen] = useState(false);
  const { watch, setValue } = useFormContext<GeneratorFormValues>();
  const multiShot = watch("multi_shot");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger>
          <CardHeader className="cursor-pointer pb-3 hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Multi-Shot Mode
                {multiShot && (
                  <Badge variant="secondary" className="text-xs">
                    Enabled
                  </Badge>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  open && "rotate-180",
                )}
              />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="multi_shot_toggle" className="cursor-pointer">
                Enable multi-shot (up to 6 scenes, max 15s total)
              </Label>
              <Switch
                id="multi_shot_toggle"
                checked={multiShot}
                onCheckedChange={(v) => setValue("multi_shot", v)}
              />
            </div>
            {multiShot && (
              <>
                <Separator />
                <MultiShotEditor />
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
