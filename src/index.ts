import assert from 'assert';
import dotenv from 'dotenv';
import { Client, Collection, ForumChannel } from 'discord.js';
import { ChannelType, Guild, Message as DMessage } from 'discord.js';
import { BrokerClient, BrokerClientContext, Message as CMessage } from 'chiqa';

dotenv.config();
const { DISCORD_TOKEN, CHIQA_HOSTNAME, CHIQA_PORT } = process.env;
assert(DISCORD_TOKEN, 'DISCORD_TOKEN is required');
assert(CHIQA_HOSTNAME, 'CHIQA_HOSTNAME is required');
assert(CHIQA_PORT, 'CHIQA_PORT is required');

const client = new Client({ intents: ['GuildMessages'] });

const fetchMember = async (guild: Guild, username: string) => {
  try {
    return await guild.members.fetch(username);
  } catch (e) {
    return null;
  }
};

const onReady = (ctx: BrokerClientContext) => {
  (async function () {
    client.once('ready', () => console.log('Discord ready'));
    client.login(DISCORD_TOKEN);
  })();
  ctx.subscribe({
    match: 'has all',
    keys: { from: 'ChiqaHttpServer', kind: 'http-request' },
  });
};

const onChiqaMessage = async (message: CMessage, ctx: BrokerClientContext) => {
  const { url } = message.payload as { url: string };
  const responseMessage = message.subMessage!;

  const [_, guildId, channelId, threadId] = url.split('/');
  if (!guildId || !channelId) {
    ctx.send({
      ...responseMessage,
      payload: { status: 400, body: 'Invalid URL' },
    });
    return;
  }

  const guild = await (async () => {
    try {
      return await client.guilds.fetch(guildId);
    } catch (e) {
      ctx.send({
        ...responseMessage,
        payload: { status: 404, body: 'Guild not found' },
      });
      return;
    }
  })();
  if (!guild) return;

  const channel = await guild.channels.fetch(channelId);
  if (!channel) {
    ctx.send({
      ...responseMessage,
      payload: { status: 404, body: 'Channel not found' },
    });
    return;
  }

  if (channel.type !== ChannelType.GuildForum) {
    ctx.send({
      ...responseMessage,
      payload: { status: 400, body: 'Channel is not a forum' },
    });
    return;
  }

  const body = threadId
    ? await GetThreadMessages(channel, threadId)
    : await GetThreads(guild, channel);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': '*',
  };
  const payload = { status: 200, headers, body };
  ctx.send({ ...responseMessage, payload });
};

const GetThreads = async (guild: Guild, channel: ForumChannel) => {
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
    }),
  );
  threadsWithData.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return threadsWithData;
};

const GetThreadMessages = async (channel: ForumChannel, threadId: string) => {
  const thread = await channel.threads.fetch(threadId);
  if (!thread) {
    return { status: 404, body: 'Thread not found' };
  }

  const messageData = await (async () => {
    let messageData: Collection<string, DMessage> = new Collection();

    let before = thread.lastMessageId;
    while (before) {
      const messages = await thread.messages.fetch({ limit: 100, before });
      messageData = messageData ? messageData.concat(messages) : messages;
      const last = messages.last();
      if (!last) break;
      before = last.id;
    }
    messageData.reverse();
    return messageData;
  })();

  const messages = messageData.map(
    ({ cleanContent, author, createdTimestamp, attachments }) => ({
      createdTimestamp,
      content: cleanContent,
      author: author.username,
      attachments: attachments.map(a => a.url),
    }),
  );
  return messages;
};

BrokerClient(
  `ws://${CHIQA_HOSTNAME}:${Number(CHIQA_PORT)}`,
  onReady,
  onChiqaMessage,
);
