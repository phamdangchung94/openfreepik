"use client";

import { useEffect, useState } from "react";

export interface PricingRule {
  endpoint: string;
  tier: "pro" | "std" | "4k" | null;
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
  endpoint:
    | "kling-v3"
    | "kling-4k-t2v"
    | "kling-4k-i2v"
    | "wan-v27"
    | "kling-motion-v2-6-std"
    | "kling-motion-v2-6-pro"
    | "kling-motion-v3-std"
    | "kling-motion-v3-pro"
    | "improve-prompt";
  tier?: "pro" | "std" | "4k" | null;
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

/**
 * Motion control bills per-second with ceiling rounding (different from
 * other models which charge by discrete duration tier). Derive the
 * per-second rate from any pricing row for this endpoint — every row's
 * `costEur / durationSeconds` is the same rate by construction (the
 * seed SQL multiplies a single rate × the duration).
 *
 * Returns null if no rule exists for the endpoint (admin needs to seed).
 */
export function lookupMotionCostPerSec(
  rules: PricingRule[],
  endpoint: string,
  exactSeconds: number,
): number | null {
  const row = rules.find(
    (r) =>
      r.endpoint === endpoint &&
      r.durationSeconds !== null &&
      r.durationSeconds > 0,
  );
  if (!row || !row.durationSeconds) return null;
  const ratePerSec = row.costEur / row.durationSeconds;
  const billed = Math.max(1, Math.ceil(exactSeconds));
  return billed * ratePerSec;
}
