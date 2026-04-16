/** Default values for the generator form. */

import type { GeneratorFormValues } from "./generator-schema";

export const FORM_DEFAULTS: GeneratorFormValues = {
  mode: "t2v",
  prompt: "",
  negative_prompt: "blur, distort, and low quality",
  start_image_url: "",
  end_image_url: "",
  tier: "pro",
  aspect_ratio: "16:9",
  duration: "5",
  cfg_scale: 0.5,
  generate_audio: true,
  multi_shot: false,
  shot_type: "customize",
  multi_prompt: [],
  elements: [],
  webhook_url: "",
};
