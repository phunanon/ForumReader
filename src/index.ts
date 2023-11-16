import assert from "assert";
import dotenv from "dotenv";
import { ChannelType, Client, Collection, Guild, Message } from "discord.js";
import express from "express";
dotenv.config();
assert(process.env.DISCORD_TOKEN, "DISCORD_TOKEN is required");

const app = express();
const client = new Client({ intents: ["GuildMessages"] });
const port = 3000;
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Expose-Headers", "*");
  next();
});

(async function () {
  client.once("ready", () => console.log("Discord ready"));
  client.login(process.env.DISCORD_TOKEN);
})();

app.listen(port, () => {
  console.log(`Sever ready: http://localhost:${port}`);
});

app.get("/:guildId/:channelId", (req, res) => {
  (async () => {
    const guildId = req.params.guildId;
    const channelId = req.params.channelId;
    if (
      !Number.isInteger(Number(guildId)) ||
      !Number.isInteger(Number(channelId))
    ) {
      res.status(400).send("guildId and channelId must be integers");
      return;
    }
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      res.status(400).send("Guild not found");
      return;
    }
    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      res.status(400).send("Channel not found");
      return;
    }
    if (channel.type !== ChannelType.GuildForum) {
      res.status(400).send("Channel is not a forum");
      return;
    }
    const threads = [
      ...(await channel.threads.fetch()).threads.values(),
      ...(await channel.threads.fetchArchived({ limit: 10 })).threads.values(),
    ];
    threads.reverse();
    const threadsWithData = await Promise.all(
      threads.map(async thread => {
        const { id, createdTimestamp, name, ownerId, messageCount } = thread;
        const owner = ownerId ? await fetchMember(guild, ownerId) : null;
        const [lastMessage] = (
          await thread.messages.fetch({ limit: 1 })
        ).values();
        return {
          ...{ id, title: name, createdTimestamp },
          author: owner?.user.username ?? `Unknown (${ownerId})`,
          lastTimestamp: lastMessage?.createdTimestamp ?? 0,
          messageCount,
        };
      })
    );
    threadsWithData.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
    res.send(threadsWithData);
  })();
});

app.get("/:guildId/:channelId/:threadId", (req, res) => {
  (async () => {
    const threadId = req.params.threadId;
    const guildId = req.params.guildId;
    const channelId = req.params.channelId;
    if (
      !Number.isInteger(Number(guildId)) ||
      !Number.isInteger(Number(channelId)) ||
      !Number.isInteger(Number(threadId))
    ) {
      res.status(400).send("guildId, channelId, threadId must be integers");
      return;
    }
    const guild = await client.guilds.fetch(guildId);
    if (!guild) {
      res.status(400).send("Guild not found");
      return;
    }
    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      res.status(400).send("Channel not found");
      return;
    }
    if (channel.type !== ChannelType.GuildForum) {
      res.status(400).send("Channel is not a forum");
      return;
    }
    const thread = await channel.threads.fetch(threadId);
    if (!thread) {
      res.status(400).send("Thread is unavailable");
      return;
    }

    let messageData: Collection<string, Message<true>> | undefined;
    let lastMessageId: string | undefined;
    do {
      const messages = await thread.messages.fetch({
        limit: 100,
        before: lastMessageId,
      });
      messageData = messageData ? messageData.concat(messages) : messages;
      lastMessageId = messages.last()?.id;
    } while (lastMessageId);

    messageData.reverse();
    const messages = messageData.map(
      ({ cleanContent, author, createdTimestamp, attachments }) => ({
        createdTimestamp,
        content: cleanContent,
        author: author.username,
        attachments: attachments.map(a => a.url),
      })
    );
    res.send(messages);
  })();
});

const fetchMember = async (guild: Guild, username: string) => {
  try {
    return await guild.members.fetch(username);
  } catch (e) {
    return null;
  }
};
