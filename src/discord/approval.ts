import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { describeTool, truncate, type Postable } from "./render.js";

export type ApprovalRequest = {
  thread: Postable;
  toolName: string;
  input: Record<string, unknown>;
  /** Prompt sentence rendered by Claude Code, when it supplies one. */
  title?: string;
  description?: string;
  /** Why the bot's own policy escalated this call. */
  reason: string;
  blockedPath?: string;
  /** Permission rules that would stop this prompt recurring this session. */
  suggestions?: PermissionUpdate[];
  approverIds: string[];
  timeoutMs: number;
  signal: AbortSignal;
};

/**
 * Posts an Approve/Deny prompt in the thread and resolves once someone decides,
 * the request times out, or the turn is aborted.
 */
export async function requestApproval(
  request: ApprovalRequest,
): Promise<PermissionResult> {
  const detail = describeTool(request.toolName, request.input) || "(ไม่มีรายละเอียด)";
  const canRemember = (request.suggestions?.length ?? 0) > 0;

  const embed = new EmbedBuilder()
    .setColor(0xf5a623)
    .setTitle(`⚠️ ขออนุมัติ: ${request.toolName}`)
    .setDescription(truncate(request.title ?? detail, 1000))
    .addFields({ name: "เหตุผล", value: truncate(request.reason, 1000) });

  if (request.toolName === "Bash" && typeof request.input.command === "string") {
    embed.addFields({
      name: "คำสั่ง",
      value: `\`\`\`sh\n${truncate(request.input.command, 900)}\n\`\`\``,
    });
  }
  if (request.blockedPath) {
    embed.addFields({ name: "พาธนอกขอบเขต", value: truncate(request.blockedPath, 1000) });
  }
  if (request.description) {
    embed.addFields({ name: "ผลที่จะเกิด", value: truncate(request.description, 1000) });
  }
  embed.setFooter({
    text: `อนุมัติได้: ${request.approverIds.length} คน · หมดเวลาใน ${Math.round(request.timeoutMs / 60_000)} นาที`,
  });

  const buttons = [
    new ButtonBuilder()
      .setCustomId("approve-once")
      .setLabel("อนุมัติครั้งนี้")
      .setStyle(ButtonStyle.Success),
  ];
  if (canRemember) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId("approve-always")
        .setLabel("อนุมัติและจำไว้")
        .setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(
    new ButtonBuilder().setCustomId("deny").setLabel("ปฏิเสธ").setStyle(ButtonStyle.Danger),
  );

  const prompt = await request.thread.send({
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  });

  const settle = async (
    outcome: PermissionResult,
    note: string,
    color: number,
  ): Promise<PermissionResult> => {
    embed.setColor(color).setFooter({ text: note });
    await prompt.edit({ embeds: [embed], components: [] }).catch(() => undefined);
    return outcome;
  };

  return await new Promise<PermissionResult>((resolvePromise) => {
    let settled = false;
    const collector = prompt.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: request.timeoutMs,
    });

    const finish = (result: Promise<PermissionResult>): void => {
      if (settled) return;
      settled = true;
      collector.stop("decided");
      request.signal.removeEventListener("abort", onAbort);
      void result.then(resolvePromise);
    };

    function onAbort(): void {
      finish(
        settle(
          { behavior: "deny", message: "งานถูกยกเลิกก่อนได้รับอนุมัติ" },
          "ยกเลิกแล้ว",
          0x6b7280,
        ),
      );
    }
    request.signal.addEventListener("abort", onAbort, { once: true });

    collector.on("collect", (interaction) => {
      if (!request.approverIds.includes(interaction.user.id)) {
        void interaction.reply({
          content: "คุณไม่มีสิทธิ์อนุมัติงานนี้ (อนุมัติได้เฉพาะผู้สั่งงานและ operator)",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      void interaction.deferUpdate().catch(() => undefined);

      if (interaction.customId === "deny") {
        finish(
          settle(
            {
              behavior: "deny",
              message: `ผู้ใช้ปฏิเสธคำสั่งนี้ อย่าลองใหม่ ให้อธิบายทางเลือกอื่นแทน`,
            },
            `ปฏิเสธโดย ${interaction.user.tag}`,
            0xdc2626,
          ),
        );
        return;
      }

      const remember = interaction.customId === "approve-always";
      finish(
        settle(
          {
            behavior: "allow",
            ...(remember ? { updatedPermissions: request.suggestions } : {}),
          },
          `อนุมัติโดย ${interaction.user.tag}${remember ? " (จำไว้ทั้ง session)" : ""}`,
          0x16a34a,
        ),
      );
    });

    collector.on("end", (_collected, endReason) => {
      if (endReason === "decided" || settled) return;
      finish(
        settle(
          {
            behavior: "deny",
            message: "หมดเวลารออนุมัติ ไม่มีใครตอบ จึงไม่ได้รันคำสั่งนี้",
          },
          "หมดเวลารออนุมัติ",
          0x6b7280,
        ),
      );
    });
  });
}
