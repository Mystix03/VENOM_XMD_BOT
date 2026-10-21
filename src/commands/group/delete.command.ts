import type { Command } from '../../types/command.type';
import { reply } from '../../services/message.service';
import { isBotAdmin } from '../../middleware/permission';
import { msgCache } from '../../core/msgcache';
import { logger } from '../../utils/logger';

const del: Command = {
  name: 'delete',
  aliases: ['del', 'dlt'],
  category: 'group',
  description: 'Delete a message in the group. Reply to the message you want deleted.',
  usage: 'delete (reply to target message)',
  groupOnly: true,
  adminOnly: true,
  async run({ sock, msg }) {
    if (!(await isBotAdmin(sock, msg.chat))) {
      await reply(sock, msg, '🚫 I need to be an admin to delete messages.');
      return;
    }

    if (!msg.quoted) {
      await reply(sock, msg, 'ℹ️ Reply to the message you want to delete.');
      return;
    }

    const botJid = sock.user?.id?.split(':')[0]?.replace(/\D/g, '') ?? '';
    const senderNumber = msg.quoted.senderNumber;
    const isFromMe = Boolean(
      msg.quoted.raw.key?.fromMe ||
        (botJid && senderNumber && botJid === senderNumber),
    );

    const targetKey = {
      remoteJid: msg.chat,
      fromMe: isFromMe,
      id: msg.quoted.id,
      participant: isFromMe
        ? undefined
        : (msg.quoted.raw.key?.participant ?? msg.quoted.sender),
    };

    if (msg.quoted.id) {
      msgCache.suppressAntiDelete(msg.quoted.id);
    }
    if (msg.id) {
      msgCache.suppressAntiDelete(msg.id);
    }

    try {
      await sock.sendMessage(msg.chat, { delete: targetKey });
      // Delete the command trigger message as well to keep the chat tidy
      await sock.sendMessage(msg.chat, { delete: msg.raw.key }).catch(() => {});
    } catch (err) {
      if (msg.quoted.id) {
        msgCache.unsuppressAntiDelete(msg.quoted.id);
      }
      logger.error({ err, chat: msg.chat, targetKey }, 'Manual message deletion failed');
      await reply(
        sock,
        msg,
        '⚠️ Could not delete that message. WhatsApp only permits admins to delete messages up to ~2 days old.',
      );
    }
  },
};

export default del;
