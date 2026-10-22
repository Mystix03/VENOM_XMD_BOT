import type { Command } from '../../types/command.type';
import { reply, react, editMessage } from '../../services/message.service';
import { resolveYt, ytMp4, formatViews } from '../../services/download.service';
import { logger } from '../../utils/logger';

const video: Command = {
  name: 'video',
  aliases: ['ytmp4', 'ytv', 'mp4'],
  category: 'downloader',
  description: 'Search YouTube and send the video (MP4) of the top result.',
  usage: 'video <name or YouTube url>',
  async run({ sock, msg, text }) {
    if (!text) {
      await reply(sock, msg, 'ℹ️ Usage: *video <name>*\n\nExample: _video alan walker faded_');
      return;
    }
    await react(sock, msg, '🔎');
    let dl: Awaited<ReturnType<typeof ytMp4>> | undefined;
    let stage = 'search';
    let progressTimer: NodeJS.Timeout | undefined;

    try {
      const v = await resolveYt(text);
      const baseInfo = `🎬 *${v.title}*\n👤 ${v.author}\n⏱️ ${v.duration}  •  👁️ ${formatViews(v.views)}`;

      const statusMsg = await reply(
        sock,
        msg,
        `${baseInfo}\n\n⏳ _Downloading video… (0s)_`,
      );
      await react(sock, msg, '⏳');

      stage = 'download';
      const t0 = Date.now();

      // Live progress timer: tick every 2.5 seconds with live elapsed seconds
      if (statusMsg?.key) {
        let tick = 0;
        const spinner = ['⏳', '⌛'];
        progressTimer = setInterval(() => {
          tick++;
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          const icon = spinner[tick % spinner.length];
          editMessage(
            sock,
            msg.chat,
            statusMsg.key,
            `${baseInfo}\n\n${icon} _Downloading video… (${elapsed}s)_`,
          );
        }, 2500);
      }

      dl = await ytMp4(v.url);
      clearInterval(progressTimer);

      const downloadSec = ((Date.now() - t0) / 1000).toFixed(1);
      if (statusMsg?.key) {
        await editMessage(
          sock,
          msg.chat,
          statusMsg.key,
          `${baseInfo}\n\n⚡ _Downloaded in ${downloadSec}s! Uploading to WhatsApp…_`,
        );
      }

      stage = 'WhatsApp upload';
      await sock.sendMessage(
        msg.chat,
        {
          video: { url: dl.url },
          mimetype: dl.mimetype || 'video/mp4',
          caption: `🎬 ${v.title}${dl.quality ? `\n📺 ${dl.quality}` : ''}\n⚡ Processed in ${downloadSec}s`,
          fileName: `${v.title}.mp4`.replace(/[\\/:*?"<>|]/g, ''),
        },
        { quoted: msg.raw },
      );
      await react(sock, msg, '✅');

      if (statusMsg?.key) {
        await editMessage(
          sock,
          msg.chat,
          statusMsg.key,
          `${baseInfo}\n\n✅ _Completed in ${downloadSec}s!_`,
        );
      }
    } catch (err) {
      clearInterval(progressTimer);
      logger.error({ err, stage, query: text }, '.video failed');
      await react(sock, msg, '❌');
      await reply(
        sock,
        msg,
        `❌ Could not fetch that video (${stage} failed). Please try again shortly.`,
      );
    } finally {
      clearInterval(progressTimer);
      await dl?.cleanup?.();
    }
  },
};

export default video;

