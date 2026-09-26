/**
 * visionAdapter.ts
 * ----------------------------------------------------------------------------
 * Capability-aware vision routing for a multi-provider chat proxy.
 *
 * Problem it solves:
 *   Your proxy has 3 entry points (OpenAI-compatible, Anthropic, Gemini) that
 *   forward `messages`/`contents` verbatim to whatever provider/model the
 *   client picked. If an image is attached but the chosen model is text-only
 *   (e.g. deepseek-chat, most Groq models, mixtral, o1-mini, etc.), the
 *   request either errors out or silently drops the image.
 *
 * What this module does:
 *   1. Detects images in the request, regardless of which of the 3 wire
 *      formats they arrived in (OpenAI `image_url`, Anthropic `image` block,
 *      Gemini `inlineData`).
 *   2. Looks up whether the target model is known to support native image
 *      input.
 *   3. If yes -> passes the payload through unchanged (native pass-through).
 *   4. If no  -> sends the image(s) to a configured vision-capable fallback
 *      model (Gemini by default, since GEMINI_API_KEY is already required
 *      elsewhere in this codebase), gets back a text description, and
 *      rewrites the message so the text-only model receives a text
 *      description instead of a raw image it can't read.
 *
 *   This mirrors the "combo vision adapter" pattern used by 9Router-style
 *   routers: per-request-in-the-chain capability check + transcribe-fallback,
 *   done transparently so the calling code (and the end user) doesn't need
 *   to know or care which path was taken.
 *
 * Usage (see integration notes at the bottom of this file):
 *   const adapted = await adaptForVision({
 *     provider: "openai", // "openai" | "anthropic" | "gemini"
 *     model: req.body.model,
 *     messages: req.body.messages,       // for openai/anthropic
 *     contents: req.body.contents,       // for gemini
 *   });
 *   // then forward adapted.messages / adapted.contents instead of the raw ones
 * ----------------------------------------------------------------------------
 */

export type Provider = "openai" | "anthropic" | "gemini";

export interface ExtractedImage {
  mimeType: string;
  /** base64-encoded image bytes (no data: prefix) */
  data: string;
}

export interface AdaptOptions {
  provider: Provider;
  model: string;
  /** OpenAI-style or Anthropic-style messages array */
  messages?: any[];
  /** Gemini-style contents (string or array of parts / Content objects) */
  contents?: any;
  /**
   * Override which model/provider handles the fallback description.
   * Defaults to Gemini (gemini-3.6-flash) since this codebase already
   * requires GEMINI_API_KEY for other features.
   */
  fallbackVisionModel?: string;
  /** Explicit API key for the fallback vision model. Falls back to env. */
  fallbackApiKey?: string;
}

export interface AdaptResult {
  /** true if any image was found in the original request */
  hadImage: boolean;
  /** true if the target model could not take the image natively and a
   *  transcription fallback was used */
  usedFallback: boolean;
  messages?: any[];
  contents?: any;
}

// ---------------------------------------------------------------------------
// 1. Model capability registry
// ---------------------------------------------------------------------------
// Keep this list updated as providers ship new vision models. Matching is by
// substring/regex against the model string so version suffixes don't need to
// be enumerated individually.

const VISION_MODEL_PATTERNS: Record<Provider, RegExp[]> = {
  openai: [
    /^gpt-4o/i,
    /^gpt-4\.1/i,
    /^gpt-4-turbo/i,
    /^gpt-4-vision/i,
    /^gpt-5/i,
    /^o1(?!-mini)/i, // o1 (not o1-mini, which is text-only)
    /^o3(?!-mini)/i,
    /^chatgpt-4o/i,
    // OpenRouter / Together / Groq forward third-party vision models too:
    /vision/i,
    /^llava/i,
    /pixtral/i,
    /^claude-3/i, // when routed through OpenRouter as an "openai-compatible" model id
    /^gemini/i, // ditto
    /qwen.*vl/i,
    /internvl/i,
  ],
  anthropic: [
    // All current Claude 3+ models support vision; only much older/legacy
    // model ids (pre-Claude-3) would need explicit exclusion.
    /^claude-3/i,
    /^claude-sonnet/i,
    /^claude-opus/i,
    /^claude-haiku/i,
    /^claude-fable/i,
    /^claude-mythos/i,
  ],
  gemini: [
    // Practically all current Gemini models are multimodal; keep this
    // permissive but still explicit rather than defaulting to "true" so a
    // future text-only Gemini variant doesn't silently break.
    /^gemini/i,
  ],
};

export function modelSupportsVision(provider: Provider, model: string): boolean {
  const patterns = VISION_MODEL_PATTERNS[provider] || [];
  const m = (model || "").toLowerCase();
  return patterns.some((re) => re.test(m));
}

// ---------------------------------------------------------------------------
// 2. Image detection + extraction (per wire format)
// ---------------------------------------------------------------------------

function dataUrlToImage(url: string): ExtractedImage | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/** Extracts images from an OpenAI-style `messages` array and returns them
 *  along with the index path needed to remove/replace them later. */
function extractFromOpenAIMessages(messages: any[]): {
  images: ExtractedImage[];
  hasImage: boolean;
} {
  const images: ExtractedImage[] = [];
  for (const msg of messages || []) {
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "image_url" && part.image_url?.url) {
        const url: string = part.image_url.url;
        if (url.startsWith("data:")) {
          const img = dataUrlToImage(url);
          if (img) images.push(img);
        } else {
          // Remote URL image: we can't inline it as base64 without fetching
          // it first. Mark it with a placeholder the caller can fetch, or
          // extend this function to fetch+encode if your runtime allows
          // outbound fetches to arbitrary hosts.
          images.push({ mimeType: "url", data: url });
        }
      }
    }
  }
  return { images, hasImage: images.length > 0 };
}

function extractFromAnthropicMessages(messages: any[]): {
  images: ExtractedImage[];
  hasImage: boolean;
} {
  const images: ExtractedImage[] = [];
  for (const msg of messages || []) {
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "image" && part.source?.type === "base64") {
        images.push({ mimeType: part.source.media_type, data: part.source.data });
      } else if (part?.type === "image" && part.source?.type === "url") {
        images.push({ mimeType: "url", data: part.source.url });
      }
    }
  }
  return { images, hasImage: images.length > 0 };
}

function extractFromGeminiContents(contents: any): {
  images: ExtractedImage[];
  hasImage: boolean;
} {
  const images: ExtractedImage[] = [];
  const partsArrays: any[] = [];

  if (Array.isArray(contents)) {
    for (const c of contents) {
      if (Array.isArray(c?.parts)) partsArrays.push(c.parts);
      else if (Array.isArray(c)) partsArrays.push(c);
    }
  } else if (contents && Array.isArray(contents.parts)) {
    partsArrays.push(contents.parts);
  }

  for (const parts of partsArrays) {
    for (const part of parts) {
      if (part?.inlineData?.data) {
        images.push({ mimeType: part.inlineData.mimeType || "image/jpeg", data: part.inlineData.data });
      }
    }
  }
  return { images, hasImage: images.length > 0 };
}

// ---------------------------------------------------------------------------
// 3. Fallback: describe the image(s) with a vision-capable model
// ---------------------------------------------------------------------------

async function describeImagesWithGemini(
  images: ExtractedImage[],
  apiKey: string,
  model = "gemini-3.6-flash"
): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  const parts: any[] = [
    {
      text:
        "Describe the following image(s) factually and in detail: objects, " +
        "people, text visible in the image (transcribe it verbatim), layout, " +
        "colors, and anything else relevant to answering questions about it. " +
        "Do not add commentary, only the description.",
    },
  ];

  for (const img of images) {
    if (img.mimeType === "url") {
      // Fetch remote image and inline it so Gemini can read it too.
      try {
        const res = await fetch(img.data);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        parts.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
      } catch {
        // Skip images we can't fetch rather than failing the whole request.
        continue;
      }
    } else {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
    }
  }

  const resp = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
  });

  return resp.text || "(توضیحی برای تصویر دریافت نشد)";
}

// ---------------------------------------------------------------------------
// 4. Rewriting: strip images, splice in the text description
// ---------------------------------------------------------------------------

function rewriteOpenAIMessages(messages: any[], description: string): any[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg?.content)) return msg;
    const textParts = msg.content.filter((p: any) => p?.type === "text");
    const hadImage = msg.content.some((p: any) => p?.type === "image_url");
    if (!hadImage) return msg;
    const originalText = textParts.map((p: any) => p.text).join("\n");
    return {
      ...msg,
      content: [
        {
          type: "text",
          text: `${originalText}\n\n[توضیح خودکار تصویر ضمیمه‌شده - این مدل از ورودی تصویر پشتیبانی نمی‌کند]:\n${description}`,
        },
      ],
    };
  });
}

function rewriteAnthropicMessages(messages: any[], description: string): any[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg?.content)) return msg;
    const textParts = msg.content.filter((p: any) => p?.type === "text");
    const hadImage = msg.content.some((p: any) => p?.type === "image");
    if (!hadImage) return msg;
    const originalText = textParts.map((p: any) => p.text).join("\n");
    return {
      ...msg,
      content: [
        {
          type: "text",
          text: `${originalText}\n\n[توضیح خودکار تصویر ضمیمه‌شده - این مدل از ورودی تصویر پشتیبانی نمی‌کند]:\n${description}`,
        },
      ],
    };
  });
}

function rewriteGeminiContents(contents: any, description: string): any {
  // If contents is a plain string, images can't have been in it anyway.
  if (typeof contents === "string") return contents;

  const rewriteParts = (parts: any[]) => {
    const textParts = parts.filter((p) => typeof p?.text === "string");
    const hadImage = parts.some((p) => p?.inlineData?.data);
    if (!hadImage) return parts;
    const originalText = textParts.map((p) => p.text).join("\n");
    return [
      {
        text: `${originalText}\n\n[توضیح خودکار تصویر ضمیمه‌شده - این مدل از ورودی تصویر پشتیبانی نمی‌کند]:\n${description}`,
      },
    ];
  };

  if (Array.isArray(contents)) {
    return contents.map((c: any) => {
      if (Array.isArray(c?.parts)) return { ...c, parts: rewriteParts(c.parts) };
      if (Array.isArray(c)) return rewriteParts(c);
      return c;
    });
  }
  if (contents && Array.isArray(contents.parts)) {
    return { ...contents, parts: rewriteParts(contents.parts) };
  }
  return contents;
}

// ---------------------------------------------------------------------------
// 5. Public entry point
// ---------------------------------------------------------------------------

export async function adaptForVision(opts: AdaptOptions): Promise<AdaptResult> {
  const { provider, model } = opts;

  let images: ExtractedImage[] = [];
  let hasImage = false;

  if (provider === "gemini") {
    ({ images, hasImage } = extractFromGeminiContents(opts.contents));
  } else if (provider === "anthropic") {
    ({ images, hasImage } = extractFromAnthropicMessages(opts.messages || []));
  } else {
    ({ images, hasImage } = extractFromOpenAIMessages(opts.messages || []));
  }

  // No image in the request at all -> nothing to do, pass through untouched.
  if (!hasImage) {
    return { hadImage: false, usedFallback: false, messages: opts.messages, contents: opts.contents };
  }

  // Model already handles images natively -> pass through untouched.
  if (modelSupportsVision(provider, model)) {
    return { hadImage: true, usedFallback: false, messages: opts.messages, contents: opts.contents };
  }

  // Text-only model + image present -> transcribe with the fallback model.
  const fallbackKey = opts.fallbackApiKey || process.env.GEMINI_API_KEY || "";
  if (!fallbackKey) {
    throw new Error(
      "تصویر ضمیمه شده اما مدل انتخابی ویژن ندارد و GEMINI_API_KEY (برای fallback توضیح تصویر) تنظیم نشده است."
    );
  }

  const description = await describeImagesWithGemini(
    images,
    fallbackKey,
    opts.fallbackVisionModel || "gemini-3.6-flash"
  );

  if (provider === "gemini") {
    return {
      hadImage: true,
      usedFallback: true,
      contents: rewriteGeminiContents(opts.contents, description),
    };
  }
  if (provider === "anthropic") {
    return {
      hadImage: true,
      usedFallback: true,
      messages: rewriteAnthropicMessages(opts.messages || [], description),
    };
  }
  return {
    hadImage: true,
    usedFallback: true,
    messages: rewriteOpenAIMessages(opts.messages || [], description),
  };
}

/* ----------------------------------------------------------------------------
INTEGRATION NOTES for your server.ts
----------------------------------------------------------------------------

1. Import it:

   import { adaptForVision } from "./visionAdapter";

2. In `/api/proxy/openai`, right after you read `model` and `messages` from
   req.body, and BEFORE building `payload`:

   const adapted = await adaptForVision({ provider: "openai", model, messages });
   messages = adapted.messages; // now safe to forward to the provider
   // optional: log adapted.usedFallback for debugging/analytics

3. In `/api/proxy/anthropic`, same pattern:

   const adapted = await adaptForVision({ provider: "anthropic", model: modelName, messages });
   const safeMessages = adapted.messages;
   // then use safeMessages instead of messages when building payload.messages

4. In `/api/proxy/gemini`, Gemini models are (currently) all multimodal, so
   this endpoint mostly exists for symmetry / future-proofing (e.g. if you
   add a text-only Gemini variant later, or route non-Gemini models through
   this same handler):

   const adapted = await adaptForVision({ provider: "gemini", model: modelToUse, contents: payloadContents });
   const safeContents = adapted.contents;

5. Errors: adaptForVision throws if an image is present, the target model is
   text-only, AND no GEMINI_API_KEY is configured for the fallback. Catch
   this the same way you catch other proxy errors and return a clear message
   to the client rather than letting the provider call fail with a confusing
   error.

6. Extending to a fallback/combo chain (multiple providers tried in order,
   9Router-style): call adaptForVision() once per attempt, using that
   attempt's specific provider/model — it's already designed to be called
   per-hop rather than once globally, so wrapping it in a retry loop that
   tries provider A then B then C requires no changes to this file.
---------------------------------------------------------------------------- */
