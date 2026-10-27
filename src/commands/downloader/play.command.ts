import type { Command } from '../../types/command.type';
import { reply, react, editMessage } from '../../services/message.service';
import { resolveYt, ytMp3, ytDlpDownload, formatViews } from '../../services/download.service';
import { logger } from '../../utils/logger';
import { isSudo } from '../../middleware/permission';

const play: Command = {
  name: 'play',
  aliases: ['song', 'ytmp3', 'yta'],
  category: 'downloader',
  description: 'Search YouTube and send the audio (MP3/M4A) of the top result.',
  usage: 'play <song name or YouTube url>',
  async run({ sock, msg, text }) {
    if (!text) {
      await reply(sock, msg, 'ℹ️ Usage: *play <song name>*\n\nExample: _play alan walker faded_');
      return;
    }
    await react(sock, msg, '🔎');
    let dl: Awaited<ReturnType<typeof ytMp3>> | undefined;
    let stage = 'search';
    let progressTimer: NodeJS.Timeout | undefined;

    try {
      const v = await resolveYt(text);
      const baseInfo = `🎵 *${v.title}*\n👤 ${v.author}\n⏱️ ${v.duration}  •  👁️ ${formatViews(v.views)}`;

      const statusMsg = await reply(
        sock,
        msg,
        `${baseInfo}\n\n⏳ _Downloading audio… (0s)_`,
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
            `${baseInfo}\n\n${icon} _Downloading audio… (${elapsed}s)_`,
          );
        }, 2500);
      }

      dl = await ytMp3(v.url);
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
      const sendAudio = async (mediaUrl: string, mediaMime?: string) => {
        const ext = mediaUrl.endsWith('.m4a') ? 'm4a' : 'mp3';
        await sock.sendMessage(
          msg.chat,
          {
            audio: { url: mediaUrl },
            mimetype: mediaMime || 'audio/mpeg',
            fileName: `${v.title}.${ext}`.replace(/[\\/:*?"<>|]/g, ''),
          },
          { quoted: msg.raw },
        );
      };

      try {
        await sendAudio(dl.url, dl.mimetype);
      } catch (uploadErr) {
        // If remote RapidAPI CDN link was incomplete/404'd, seamlessly fall back to local yt-dlp
        if (dl.url.startsWith('http')) {
          logger.warn(
            { uploadErr: String(uploadErr) },
            'Remote audio link failed on WhatsApp upload, falling back to local yt-dlp',
          );
          dl = await ytDlpDownload(v.url, 'audio');
          await sendAudio(dl.url, dl.mimetype);
        } else {
          throw uploadErr;
        }
      }

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
      logger.error({ err, stage, query: text }, '.play failed');
      await react(sock, msg, '❌');
      const ownerDetail = isSudo(msg.senderNumber)
        ? `\n\n🔧 Owner detail: ${String(err instanceof Error ? err.message : err)
            .replace(/:\/\/[^\s/@]+:[^\s/@]+@/g, '://***:***@')
            .slice(-700)}`
        : '';
      await reply(
        sock,
        msg,
        `❌ Could not fetch that song (${stage} failed). Please try again shortly.${ownerDetail}`,
      );
    } finally {
      clearInterval(progressTimer);
      await dl?.cleanup?.();
    }
  },
};

export default play;
