"use client";

import { useEffect, useState } from "react";

export interface PricingRule {
  endpoint: string;
  tier: "pro" | "std" | null;
  durationSeconds: number | null;
  withAudio: boolean;
  costEur: number;
}

// Module-level cache so multiple components mounting simultaneously share
// a single fetch (and don't refetch on every navigation).
let cache: PricingRule[] | null = null;
let inflight: Promise<PricingRule[]> | null = null;

async function fetchRates(): Promise<PricingRule[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/api/pricing/rates")
    .then((r) => r.json())
    .then((j) => {
      cache = (j.rules ?? []) as PricingRule[];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Hook that exposes the pricing matrix; loads once per tab. */
export function usePricingRates(): PricingRule[] | null {
  const [rules, setRules] = useState<PricingRule[] | null>(cache);

  useEffect(() => {
    if (cache) {
      setRules(cache);
      return;
    }
    let mounted = true;
    fetchRates().then((r) => {
      if (mounted) setRules(r);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return rules;
}

export interface CostLookup {
  endpoint: "kling-v3" | "wan-v27" | "improve-prompt";
  tier?: "pro" | "std" | null;
  durationSeconds?: number | null;
  withAudio?: boolean;
}

/** Mirror of server-side calculateCost — looks up a rule from the cached matrix. */
export function lookupCost(
  rules: PricingRule[],
  q: CostLookup,
): number | null {
  const tier = q.tier ?? null;
  const duration = q.durationSeconds ?? null;
  const audio = q.withAudio ?? false;
  const found = rules.find(
    (r) =>
      r.endpoint === q.endpoint &&
      r.tier === tier &&
      r.durationSeconds === duration &&
      r.withAudio === audio,
  );
  return found ? found.costEur : null;
}
