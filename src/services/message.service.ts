import type { WASocket, AnyMessageContent, proto } from '@whiskeysockets/baileys';
import type { SerializedMessage } from '../types/message.type';

/** Send plain text to any chat. */
export async function sendText(
  sock: WASocket,
  jid: string,
  text: string,
) {
  return await sock.sendMessage(jid, { text });
}

/** Reply to a message, quoting the original. */
export async function reply(
  sock: WASocket,
  msg: SerializedMessage,
  text: string,
) {
  return await sock.sendMessage(msg.chat, { text }, { quoted: msg.raw });
}

/** Edit a previously sent message if supported by the chat. */
export async function editMessage(
  sock: WASocket,
  chat: string,
  key: proto.IMessageKey,
  text: string,
) {
  return await sock.sendMessage(chat, { text, edit: key }).catch(() => undefined);
}

/** React to a message with an emoji. */
export async function react(
  sock: WASocket,
  msg: SerializedMessage,
  emoji: string,
): Promise<void> {
  await sock.sendMessage(msg.chat, {
    react: { text: emoji, key: msg.raw.key },
  });
}

/** Send an image (from a Buffer or URL) with an optional caption. */
export async function sendImage(
  sock: WASocket,
  jid: string,
  image: Buffer | { url: string },
  caption?: string,
): Promise<void> {
  await sock.sendMessage(jid, { image, caption } as AnyMessageContent);
}

/** Send arbitrary content while quoting a message. */
export async function sendReplyContent(
  sock: WASocket,
  msg: SerializedMessage,
  content: AnyMessageContent,
): Promise<void> {
  await sock.sendMessage(msg.chat, content, { quoted: msg.raw });
}
