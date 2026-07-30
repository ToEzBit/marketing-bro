import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";

/** Discord's upload ceiling for a server without a boost tier. */
export const DISCORD_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

/** The tool name Claude sees, and the one the permission policy matches on. */
export const SEND_FILE_TOOL = "mcp__discord__send_file";

export type SendFile = (
  buffer: Buffer,
  filename: string,
  caption: string | undefined,
) => Promise<void>;

function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Gives the agent a way to put a real file into the Discord thread. Without it
 * the agent can only describe a file it read, which is not what "show me this
 * image" means.
 */
export function createDiscordToolServer(options: {
  workspace: string;
  sendFile: SendFile;
}): McpSdkServerConfigWithInstance {
  const sendFileTool = tool(
    "send_file",
    "Post a file from this machine into the Discord thread as an attachment. " +
      "Use this whenever the user asks to see, show, view, or send a file — " +
      "especially images, screenshots, PDFs, or generated output. Describing the " +
      "file in text is not a substitute. Images render inline in Discord.",
    {
      path: z
        .string()
        .describe(
          "Path to the file to post. Absolute, or relative to the working directory.",
        ),
      caption: z
        .string()
        .optional()
        .describe("Optional one-line message posted alongside the file."),
    },
    async ({ path, caption }) => {
      const target = isAbsolute(path) ? path : resolve(options.workspace, path);

      let size: number;
      try {
        const info = await stat(target);
        if (!info.isFile()) {
          return {
            content: [{ type: "text", text: `Not a file: ${target}` }],
            isError: true,
          };
        }
        size = info.size;
      } catch {
        return {
          content: [{ type: "text", text: `File not found: ${target}` }],
          isError: true,
        };
      }

      if (size > DISCORD_UPLOAD_LIMIT_BYTES) {
        return {
          content: [
            {
              type: "text",
              text:
                `File is ${humanSize(size)}, over Discord's ${humanSize(DISCORD_UPLOAD_LIMIT_BYTES)} ` +
                `upload limit, so it was not sent. Shrink it to a temporary copy and send that ` +
                `instead — for an image on macOS: ` +
                `\`sips -Z 2000 "${target}" --out /tmp/${basename(target)}\`; ` +
                `on Windows or Linux use an equivalent resize. Then call send_file on the copy.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const buffer = await readFile(target);
        await options.sendFile(buffer, basename(target), caption);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Failed to post the file: ${detail}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text:
              `Posted ${basename(target)} (${humanSize(size)}) to the thread. ` +
              `The user can see it now — do not describe its contents unless asked.`,
          },
        ],
      };
    },
  );

  return createSdkMcpServer({ name: "discord", version: "1.0.0", tools: [sendFileTool] });
}
