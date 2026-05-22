/** Default values for the generator form. */

import type { GeneratorFormValues } from "./generator-schema";

export const FORM_DEFAULTS: GeneratorFormValues = {
  model: "kling-v3",
  mode: "t2v",
  prompt: "",
  negative_prompt: "blur, distort, and low quality",
  start_image_url: "",
  end_image_url: "",
  tier: "pro",
  aspect_ratio: "16:9",
  resolution: "1080P",
  duration: "5",
  cfg_scale: 0.5,
  generate_audio: true,
  multi_shot: false,
  shot_type: "customize",
  multi_prompt: [],
  elements: [],
  webhook_url: "",
  // Kling Motion Control defaults — irrelevant when model="kling-v3"
  // but the form schema requires them so RHF resets cleanly.
  motion_tier: "v2-6-std",
  motion_orientation: "video",
  motion_video_url: "",
  motion_video_duration: 0,
  output_duration: 5,
  // Kling Omni defaults — only used when model="kling-omni" but form
  // schema requires the keys present for RHF reset.
  omni_mode: "video",
  omni_input: "t2v",
  omni_tier: "std",
  omni_video_url: "",
  omni_video_duration: 0,
  omni_audio: false,
  omni_duration: "5",
  omni_aspect_ratio: "16:9",
  omni_multi_shot: false,
  omni_multi_prompt: [],
};
