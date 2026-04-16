# Phase 3 — Generator Form UI

**Status:** ☐ Not started
**Priority:** High
**Depends on:** Phase 1, Phase 2

## Overview

Build the primary UI surface: a clean, responsive generator form with every Kling 3 parameter surfaced sensibly. No submission logic yet (Phase 5 wires that up) — **this phase is about the controlled form** with validated state and a visually complete experience.

## Key Insights

- Freepik's Kling 3 form has a lot of optional fields. The UI must keep the *essential* ones (prompt, mode, duration, aspect, quality) front-and-center and tuck the rest into collapsible "Advanced" / "Multi-shot" sections.
- The form state is the **single source of truth** for both Phase 4 (improve prompt writes to it) and Phase 5 (submit reads it).
- `react-hook-form` + `zodResolver` gives us typed state, validation, and clean controlled components.
- All form labels, placeholders, and help text should be in **English** (per the Freepik docs language), but error messages should be friendly — we'll do a light Vietnamese pass in Phase 6 if the user asks.
- Two modes — T2V vs I2V — toggle different required fields. The form resolver branches on mode.

## Requirements

### Functional
- A single `<GeneratorForm />` component renders the full form.
- Form fields (all in one card, grouped):
  - **Mode toggle**: Text-to-Video | Image-to-Video (segmented control)
  - **Prompt** (textarea, 2500-char counter, required in T2V or when not multi-shot)
  - **Improve Prompt button** (right of prompt label, disabled until prompt non-empty; wired in Phase 4)
  - **Negative prompt** (collapsible "Advanced", textarea, 2500-char counter, defaulted to `"blur, distort, and low quality"`)
  - **Start image URL** (visible only in I2V mode, required there)
  - **End image URL** (visible only in I2V mode, optional)
  - **Aspect ratio picker** (three visual buttons: 16:9 / 9:16 / 1:1 with icons)
  - **Duration slider** (3–15s, with numeric display)
  - **Quality tier** (Pro / Std segmented)
  - **Generate audio** (toggle, default on)
  - **CFG scale slider** (0–1, step 0.05, tooltip explaining)
  - **Multi-shot** section (collapsible): toggle on/off → shows shot editor (add up to 6 shots; each has prompt + duration; live total-duration bar with cap warning at 15s)
  - **Element references** (collapsible advanced): array of `{ frontal_image_url, reference_image_urls[] }`
  - **Webhook URL** (collapsible, optional string)
- Character counters are live and turn red when over limit.
- Aspect-ratio buttons visually preview the shape (CSS box with border).
- Form is responsive from 360px (mobile) to 1920px (desktop). On mobile the form stacks; on desktop it uses a two-column layout with a right-hand preview panel (empty in this phase; will become the video player in Phase 5).
- A `Generate` submit button sits at the bottom — disabled if form invalid. Clicking it in this phase just `console.log`s the parsed params.

### Non-functional
- Form re-renders only when a field changes (react-hook-form handles this for us).
- All shadcn components come from `components/ui/*`.
- Each sub-component file < 200 LOC.

## Architecture

```
src/
├── components/
│   ├── ui/                              ← shadcn primitives
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── label.tsx
│   │   ├── slider.tsx
│   │   ├── switch.tsx
│   │   ├── card.tsx
│   │   ├── tabs.tsx
│   │   ├── collapsible.tsx
│   │   ├── tooltip.tsx
│   │   ├── badge.tsx
│   │   └── separator.tsx
│   └── generator/
│       ├── generator-form.tsx           ← main form (assembly)
│       ├── mode-toggle.tsx              ← T2V ↔ I2V segmented
│       ├── prompt-field.tsx             ← textarea + char counter + improve-prompt slot
│       ├── negative-prompt-field.tsx
│       ├── image-url-field.tsx          ← reusable for start/end
│       ├── aspect-ratio-picker.tsx      ← three visual buttons
│       ├── duration-slider.tsx
│       ├── quality-tier-picker.tsx      ← Pro / Std segmented
│       ├── cfg-scale-slider.tsx
│       ├── generate-audio-switch.tsx
│       ├── multi-shot-editor.tsx        ← collapsible + shot list
│       ├── multi-shot-item.tsx          ← single scene row
│       ├── element-editor.tsx           ← collapsible advanced
│       ├── webhook-url-field.tsx
│       └── generate-button.tsx
└── lib/
    └── form/
        ├── generator-schema.ts          ← zod schema, branches on mode
        ├── defaults.ts                  ← default form values
        └── to-api-params.ts             ← form state → KlingV3GenerateParams
```

### Form schema sketch

```ts
// src/lib/form/generator-schema.ts
const t2vSchema = z.object({
  mode: z.literal('t2v'),
  prompt: z.string().min(1).max(2500),
  // ...
});
const i2vSchema = z.object({
  mode: z.literal('i2v'),
  prompt: z.string().max(2500).optional(),
  startImageUrl: z.string().url(),
  endImageUrl: z.string().url().optional().or(z.literal('')),
  // ...
});
export const generatorFormSchema = z.discriminatedUnion('mode', [t2vSchema, i2vSchema]);
export type GeneratorFormValues = z.infer<typeof generatorFormSchema>;
```

## Related Code Files

### Create
- All files under `src/components/generator/*`
- All files under `src/lib/form/*`
- Additional shadcn components via CLI as needed: `textarea`, `slider`, `switch`, `card`, `tabs`, `collapsible`, `tooltip`, `badge`, `separator`, `label`, `input`

### Modify
- `src/app/page.tsx` — replace hero placeholder with `<GeneratorForm />` inside a two-column layout (form left, empty preview panel right with placeholder text "Your video will appear here").
- `package.json` — add `react-hook-form`, `@hookform/resolvers`

## Implementation Steps

1. **Add deps**: `pnpm add react-hook-form @hookform/resolvers` (zod already installed in Phase 2).

2. **Install shadcn components**:
   ```bash
   pnpm dlx shadcn@latest add textarea slider switch card tabs collapsible tooltip badge separator label input
   ```

3. **Write `generator-schema.ts`** with discriminated union on `mode`, strict char limits, and cross-field check for multi-shot total duration ≤ 15.

4. **Write `defaults.ts`** — sensible defaults: mode = `'t2v'`, duration = `'5'`, aspectRatio = `'16:9'`, cfgScale = 0.5, generateAudio = true, multiShot = false, tier = `'pro'`, negativePrompt = `'blur, distort, and low quality'`.

5. **Write `to-api-params.ts`** — pure function: `(formValues) => KlingV3GenerateParams`. Drops empty strings, trims, maps `mode` + `startImageUrl` to the right field names.

6. **Build `generator-form.tsx`** — sets up `useForm` with `zodResolver(generatorFormSchema)`, wraps children in `<FormProvider>`, renders a `Card` with grouped sections:
   - **Section 1 — Prompt**: `<ModeToggle /> <PromptField /> <NegativePromptField />`
   - **Section 2 — Image Inputs** (only when `mode === 'i2v'`): `<ImageUrlField name="startImageUrl" label="Start frame URL" required />` + `<ImageUrlField name="endImageUrl" label="End frame URL (optional)" />`
   - **Section 3 — Video Settings**: `<AspectRatioPicker /> <DurationSlider /> <QualityTierPicker /> <GenerateAudioSwitch />`
   - **Section 4 — Advanced** (collapsible): `<CfgScaleSlider /> <WebhookUrlField />`
   - **Section 5 — Multi-shot** (collapsible): `<MultiShotEditor />`
   - **Section 6 — Element References** (collapsible, "Consistency"): `<ElementEditor />`
   - `<GenerateButton />` at the bottom

7. **Implement each sub-component** — each one is a thin wrapper over shadcn primitives using `useFormContext()`. Keep props minimal. Examples:

   ```tsx
   // prompt-field.tsx (sketch)
   const { register, watch } = useFormContext<GeneratorFormValues>();
   const value = watch('prompt') ?? '';
   return (
     <div>
       <div className="flex justify-between">
         <Label>Prompt</Label>
         <span className={cn('text-xs', value.length > 2500 && 'text-destructive')}>
           {value.length}/2500
         </span>
       </div>
       <Textarea rows={5} placeholder="A cinematic shot of…" {...register('prompt')} />
     </div>
   );
   ```

8. **Aspect ratio picker** — three `button` elements, each showing a small CSS box sized to the ratio, with active ring when selected. No shadcn group needed — raw buttons.

9. **Multi-shot editor** — a `FieldArray` pattern with `useFieldArray`; each row has a prompt textarea + duration select (3–15). Live total bar: `sum(durations) / 15`. Over-cap → disabled Add button + warning badge.

10. **Wire into `page.tsx`** — two-column layout: `grid lg:grid-cols-[1fr_420px] gap-6`. Left: `<GeneratorForm onSubmit={(v) => console.log(toApiParams(v))} />`. Right: placeholder empty-state card.

11. **Visual QA** — resize browser from 360px to 1920px; everything readable; multi-shot editor scrollable on mobile.

12. **TypeScript** — `pnpm tsc --noEmit` passes.

## Todo List

- [ ] Install `react-hook-form @hookform/resolvers`
- [ ] Install shadcn components (textarea, slider, switch, card, tabs, collapsible, tooltip, badge, separator, label, input)
- [ ] `lib/form/generator-schema.ts`
- [ ] `lib/form/defaults.ts`
- [ ] `lib/form/to-api-params.ts`
- [ ] `components/generator/generator-form.tsx`
- [ ] `mode-toggle.tsx`
- [ ] `prompt-field.tsx`
- [ ] `negative-prompt-field.tsx`
- [ ] `image-url-field.tsx`
- [ ] `aspect-ratio-picker.tsx`
- [ ] `duration-slider.tsx`
- [ ] `quality-tier-picker.tsx`
- [ ] `cfg-scale-slider.tsx`
- [ ] `generate-audio-switch.tsx`
- [ ] `multi-shot-editor.tsx` + `multi-shot-item.tsx`
- [ ] `element-editor.tsx`
- [ ] `webhook-url-field.tsx`
- [ ] `generate-button.tsx`
- [ ] Replace `src/app/page.tsx` hero with the two-column layout
- [ ] Manual visual QA at 360px / 768px / 1280px / 1920px widths
- [ ] `pnpm tsc --noEmit` passes

## Success Criteria

- The form renders with all sections and shadcn styling.
- Changing mode shows/hides image URL fields correctly.
- Character counters turn red past 2500.
- Multi-shot editor enforces the 15s total cap.
- Submitting with valid data logs a correctly-shaped `KlingV3GenerateParams` object to the console.
- Layout is responsive and readable on mobile + desktop.
- No TypeScript errors.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Too many fields → overwhelming UI | Collapsible Advanced / Multi-shot / Elements sections; sensible defaults cover 90% of users |
| `react-hook-form` + `useFieldArray` + zod discriminated union is tricky | Keep the schema simple; if it fights us, fall back to a flat schema + custom `superRefine` |
| shadcn `Slider` doesn't support step=0.05 nicely | Use `Slider` with step prop + `Input type="number"` for precise values |

## Security Considerations

- URL fields validated with `z.string().url()` — prevents obvious XSS from malformed inputs.
- No `dangerouslySetInnerHTML` anywhere.
- Webhook URL is trusted but **only** forwarded to Freepik by Phase 2's proxy — never fetched from our server.

## Next Steps

Proceed to [phase-04-improve-prompt-integration.md](./phase-04-improve-prompt-integration.md) to wire the Improve Prompt button to the real API.
