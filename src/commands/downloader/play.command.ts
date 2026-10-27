import type { Command } from '../../types/command.type';
import { reply, react, editMessage } from '../../services/message.service';
import { resolveYt, ytMp3, ytDlpDownload, formatViews } from '../../services/download.service';
import { logger } from '../../utils/logger';
import { isSudo } from '../../middleware/permission';

function renderProgressBar(pct: number, length = 10): string {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const filled = Math.min(length, Math.max(0, Math.round((clamped / 100) * length)));
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${clamped}%`;
}

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
    await react(sock, msg, '⏳');
    const t0 = Date.now();
    let stage = 'search';
    let progressTimer: NodeJS.Timeout | undefined;
    let dl: Awaited<ReturnType<typeof ytMp3>> | undefined;
    let statusMsg: Awaited<ReturnType<typeof reply>> | undefined;

    try {
      // 0%: Bot received command & begins searching YouTube
      statusMsg = await reply(
        sock,
        msg,
        `⏳ ${renderProgressBar(0)}\n_Receiving request & searching YouTube for: "${text.slice(0, 60)}"…_`,
      );

      const v = await resolveYt(text);
      const baseInfo = `🎵 *${v.title}*\n👤 ${v.author}\n⏱️ ${v.duration}  •  👁️ ${formatViews(v.views)}`;

      stage = 'download';
      let percent = 20;
      const statusKey = statusMsg?.key;

      if (statusKey) {
        await editMessage(
          sock,
          msg.chat,
          statusKey,
          `${baseInfo}\n\n⏳ ${renderProgressBar(percent)}\n_Converting & downloading audio…_`,
        );
      }

      // Smooth progress ticker: scales from 20% up to 95% while converting / downloading
      if (statusKey) {
        let tick = 0;
        const spinner = ['⏳', '⌛'];
        progressTimer = setInterval(() => {
          tick++;
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          const icon = spinner[tick % spinner.length];
          percent = Math.min(95, percent + Math.max(2, Math.round((96 - percent) * 0.22)));
          editMessage(
            sock,
            msg.chat,
            statusKey,
            `${baseInfo}\n\n${icon} ${renderProgressBar(percent)} (${elapsed}s)\n_Converting & downloading audio…_`,
          );
        }, 1600);
      }

      dl = await ytMp3(v.url);
      clearInterval(progressTimer);

      const downloadSec = ((Date.now() - t0) / 1000).toFixed(1);

      // 100%: Download and conversion complete; now uploading to WhatsApp
      if (statusKey) {
        await editMessage(
          sock,
          msg.chat,
          statusKey,
          `${baseInfo}\n\n⚡ ${renderProgressBar(100)} (${downloadSec}s)\n_Uploading MP3 to WhatsApp…_`,
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
      const totalSec = ((Date.now() - t0) / 1000).toFixed(1);

      if (statusKey) {
        await editMessage(
          sock,
          msg.chat,
          statusKey,
          `${baseInfo}\n\n✅ ${renderProgressBar(100)}\n_Uploaded in ${totalSec}s! Enjoy the music 🎧_`,
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
      const errMsg = `❌ Could not fetch that song (${stage} failed). Please try again shortly.${ownerDetail}`;
      const statusKey = statusMsg?.key;
      if (statusKey) {
        await editMessage(sock, msg.chat, statusKey, errMsg);
      } else {
        await reply(sock, msg, errMsg);
      }
    } finally {
      clearInterval(progressTimer);
      await dl?.cleanup?.();
    }
  },
};

export default play;
