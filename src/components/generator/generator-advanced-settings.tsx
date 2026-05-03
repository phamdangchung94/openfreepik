"use client";

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CfgScaleSlider } from "./cfg-scale-slider";
import { NegativePromptField } from "./negative-prompt-field";

export function GeneratorAdvancedSettings() {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger>
          <CardHeader className="cursor-pointer pb-3 hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Cài đặt nâng cao
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
            <CfgScaleSlider />
            <Separator />
            <NegativePromptField />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
