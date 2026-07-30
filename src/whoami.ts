/**
 * Diagnostic: run with `npm run whoami`.
 * Prints the bot identity, which guilds it is actually a member of, and its
 * effective permissions per text channel. Use this when the bot appears absent
 * from a server or silently cannot post in a channel.
 */
import { config as loadEnv } from "dotenv";
import { ChannelType, Client, Events, GatewayIntentBits, PermissionsBitField } from "discord.js";

loadEnv({ quiet: true } as never);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (ready) => {
  console.log(`bot identity : ${ready.user.tag} (id ${ready.user.id})`);
  console.log(`guilds seen  : ${ready.guilds.cache.size}`);

  for (const [, guild] of ready.guilds.cache) {
    console.log(`\n── ${guild.name} (id ${guild.id}) ──`);
    const me = await guild.members.fetchMe();
    console.log(`  bot nickname     : ${me.displayName}`);
    console.log(`  bot roles        : ${me.roles.cache.map((r) => r.name).join(", ")}`);

    const needed = [
      ["ViewChannel", PermissionsBitField.Flags.ViewChannel],
      ["SendMessages", PermissionsBitField.Flags.SendMessages],
      ["CreatePublicThreads", PermissionsBitField.Flags.CreatePublicThreads],
      ["SendMessagesInThreads", PermissionsBitField.Flags.SendMessagesInThreads],
      ["EmbedLinks", PermissionsBitField.Flags.EmbedLinks],
      ["AttachFiles", PermissionsBitField.Flags.AttachFiles],
      ["AddReactions", PermissionsBitField.Flags.AddReactions],
      ["ReadMessageHistory", PermissionsBitField.Flags.ReadMessageHistory],
    ] as const;

    const missingServerWide = needed.filter(([, flag]) => !me.permissions.has(flag)).map(([n]) => n);
    console.log(
      `  server-wide perms: ${missingServerWide.length === 0 ? "ครบ" : `ขาด ${missingServerWide.join(", ")}`}`,
    );

    const textChannels = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildText,
    );
    console.log(`  text channels    : ${textChannels.size}`);
    for (const [, channel] of textChannels) {
      if (!("permissionsFor" in channel)) continue;
      const perms = channel.permissionsFor(me);
      const missing = needed.filter(([, flag]) => !perms?.has(flag)).map(([n]) => n);
      console.log(
        `    #${channel.name.padEnd(20)} ${missing.length === 0 ? "✅ ใช้งานได้" : `❌ ขาด ${missing.join(", ")}`}`,
      );
    }
  }

  const commands = await client.application?.commands.fetch();
  console.log(`\nglobal slash commands registered: ${commands?.size ?? 0}`);
  for (const [, command] of commands ?? []) console.log(`  /${command.name}`);

  await client.destroy();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN).catch((error: unknown) => {
  console.error("login failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
