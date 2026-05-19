import { NextResponse } from "next/server";

/**
 * GET /api/v1/openapi.json
 *
 * Static OpenAPI 3.1 spec for the public /api/v1/* surface. AI tools
 * (ChatGPT custom GPTs, Cursor, Claude MCP, Cline) can fetch this
 * URL to auto-generate clients or tool descriptions.
 *
 * Brand-neutral on purpose — strings here are what customers see in
 * their tool catalogs.
 */
export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(buildSpec(origin), {
    headers: {
      // CORS — AI tools fetch this from browser contexts.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}

function buildSpec(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Video AI API",
      version: "1.0.0",
      description:
        "Public REST API for AI video generation. Authenticate with an API key (sk_*) issued from the admin dashboard.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "sk_*",
        },
      },
      schemas: {
        Balance: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["topup", "unlimited"] },
            usedEur: { type: "number" },
            quotaEur: { type: "number", nullable: true },
            remainingEur: { type: "number", nullable: true },
          },
        },
        Error: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [false] },
            error: { type: "string" },
            message: { type: "string" },
          },
        },
        TaskCreated: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [true] },
            task_id: { type: "string" },
            balance: { $ref: "#/components/schemas/Balance" },
          },
        },
        TaskStatus: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [true] },
            task_id: { type: "string" },
            status: {
              type: "string",
              enum: ["CREATED", "IN_PROGRESS", "COMPLETED", "FAILED"],
            },
            generated: { type: "array", items: { type: "string" } },
            error_message: { type: "string", nullable: true },
          },
        },
      },
    },
    paths: {
      "/me": {
        get: {
          summary: "Validate API key and read balance",
          operationId: "getMe",
          responses: {
            "200": {
              description: "Key info + balance",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      key: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          label: { type: "string" },
                          rateLimitPerMin: { type: "integer", nullable: true },
                        },
                      },
                      balance: { $ref: "#/components/schemas/Balance" },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Auth failed",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
      "/video/kling-3": {
        post: {
          summary: "Create a Kling 3 video (T2V or I2V)",
          operationId: "createKling3Video",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tier", "params"],
                  properties: {
                    tier: { type: "string", enum: ["pro", "std"] },
                    params: {
                      type: "object",
                      properties: {
                        prompt: { type: "string", maxLength: 2500 },
                        image: { type: "string", description: "URL or base64 (I2V only)" },
                        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
                        duration: { type: "string", enum: ["5", "10"] },
                        generate_audio: { type: "boolean" },
                        cfg_scale: { type: "number", minimum: 0, maximum: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TaskCreated" } },
              },
            },
          },
        },
      },
      "/video/kling-3-4k-text": {
        post: {
          summary: "Create a Kling 3 4K text-to-video",
          operationId: "createKling34kText",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["params"],
                  properties: {
                    params: {
                      type: "object",
                      required: ["prompt"],
                      properties: {
                        prompt: { type: "string", maxLength: 2500 },
                        aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"] },
                        duration: { type: "string" },
                        generate_audio: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TaskCreated" } },
              },
            },
          },
        },
      },
      "/video/kling-3-4k-image": {
        post: {
          summary: "Create a Kling 3 4K image-to-video",
          operationId: "createKling34kImage",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["params"],
                  properties: {
                    params: {
                      type: "object",
                      required: ["image"],
                      properties: {
                        image: { type: "string", description: "URL or base64" },
                        prompt: { type: "string", maxLength: 2500 },
                        duration: { type: "string" },
                        cfg_scale: { type: "number", minimum: 0, maximum: 1 },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TaskCreated" } },
              },
            },
          },
        },
      },
      "/video/kling-motion/{tier}": {
        post: {
          summary: "Create a Kling Motion Control video",
          operationId: "createKlingMotion",
          parameters: [
            {
              name: "tier",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: ["v2-6-std", "v2-6-pro", "v3-std", "v3-pro"],
              },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["params", "output_duration"],
                  properties: {
                    params: {
                      type: "object",
                      required: ["image_url", "video_url"],
                      properties: {
                        image_url: { type: "string", format: "uri" },
                        video_url: { type: "string", format: "uri" },
                        prompt: { type: "string", maxLength: 2500 },
                        character_orientation: {
                          type: "string",
                          enum: ["video", "image"],
                          default: "video",
                        },
                        cfg_scale: { type: "number", minimum: 0, maximum: 1 },
                      },
                    },
                    output_duration: {
                      type: "integer",
                      minimum: 5,
                      maximum: 30,
                      description:
                        "Seconds of output video. Max 30s for orientation=video, 10s for orientation=image.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task created",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TaskCreated" } },
              },
            },
          },
        },
      },
      "/prompt/improve": {
        post: {
          summary: "Expand a short prompt into a detailed one (free)",
          operationId: "improvePrompt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["prompt", "type"],
                  properties: {
                    prompt: { type: "string", maxLength: 2500 },
                    type: { type: "string", enum: ["image", "video"] },
                    language: { type: "string", maxLength: 10 },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Task created — poll /tasks/{id} for the result text in generated[0]",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      task_id: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/tasks/{taskId}": {
        get: {
          summary: "Poll task status — universal endpoint for every model",
          operationId: "getTask",
          parameters: [
            {
              name: "taskId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Current task status",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/TaskStatus" } },
              },
            },
            "404": {
              description: "Unknown task_id",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Error" } },
              },
            },
          },
        },
      },
    },
  };
}
