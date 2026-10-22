import type { Command } from '../../types/command.type';
import { reply, react } from '../../services/message.service';

interface ActiveTimer {
  id: number;
  label: string;
  durationMs: number;
  endsAt: number;
  timeout: NodeJS.Timeout;
}

// In-memory store of active timers per user
const userTimers = new Map<string, ActiveTimer[]>();
let nextTimerId = 1;

/** Parse compound time strings like 10s, 5m, 1h, 1h30m, 45s */
function parseDuration(input: string): number | null {
  const clean = input.toLowerCase().trim();
  if (/^\d+$/.test(clean)) {
    // Pure number defaults to seconds
    const sec = parseInt(clean, 10);
    return sec > 0 ? sec * 1000 : null;
  }

  const match = clean.match(/^((?:\d+(?:\.\d+)?(?:d|h|m|s))+)$/);
  if (!match) return null;

  let totalMs = 0;
  const regex = /(\d+(?:\.\d+)?)(d|h|m|s)/g;
  let part: RegExpExecArray | null;
  while ((part = regex.exec(clean)) !== null) {
    const val = parseFloat(part[1]);
    const unit = part[2];
    if (unit === 'd') totalMs += val * 86400000;
    else if (unit === 'h') totalMs += val * 3600000;
    else if (unit === 'm') totalMs += val * 60000;
    else if (unit === 's') totalMs += val * 1000;
  }
  return totalMs > 0 ? Math.round(totalMs) : null;
}

/** Format milliseconds into readable duration string */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

const timerCommand: Command = {
  name: 'timer',
  aliases: ['remind', 'reminder', 'alarm', 'timers'],
  category: 'tools',
  description: 'Set a countdown timer or reminder with custom duration and label.',
  usage: 'timer <duration> [reason] | timer list | timer cancel <id>',
  async run({ sock, msg, args, text, prefix }) {
    const sender = msg.sender;
    const sub = (args[0] || '').toLowerCase();

    // 1. List active timers
    if (sub === 'list' || sub === 'all' || msg.body.trim().toLowerCase() === `${prefix}timers`) {
      const active = userTimers.get(sender) || [];
      if (active.length === 0) {
        await reply(sock, msg, 'ℹ️ You have no active timers.\n\n_Start one with:_ `' + prefix + 'timer 5m check oven`');
        return;
      }
      const now = Date.now();
      const list = active
        .map(
          (t) =>
            `• *[#${t.id}]* _${t.label}_ — *${formatDuration(Math.max(0, t.endsAt - now))}* left`,
        )
        .join('\n');
      await reply(sock, msg, `⏳ *Your Active Timers:*\n\n${list}\n\n_Cancel anytime with:_ \`${prefix}timer cancel <id>\``);
      return;
    }

    // 2. Cancel a timer
    if (sub === 'cancel' || sub === 'stop' || sub === 'del') {
      const active = userTimers.get(sender) || [];
      if (active.length === 0) {
        await reply(sock, msg, 'ℹ️ You have no active timers to cancel.');
        return;
      }

      const target = (args[1] || '').toLowerCase();
      if (target === 'all') {
        for (const t of active) clearTimeout(t.timeout);
        userTimers.delete(sender);
        await reply(sock, msg, '✅ Cleared all your active timers.');
        return;
      }

      const id = parseInt(target, 10);
      if (Number.isNaN(id)) {
        await reply(sock, msg, `ℹ️ Usage: *${prefix}timer cancel <id>* or *${prefix}timer cancel all*`);
        return;
      }

      const idx = active.findIndex((t) => t.id === id);
      if (idx === -1) {
        await reply(sock, msg, `❌ Timer #${id} not found.`);
        return;
      }

      clearTimeout(active[idx].timeout);
      active.splice(idx, 1);
      if (active.length === 0) userTimers.delete(sender);
      await reply(sock, msg, `✅ Timer #${id} has been cancelled.`);
      return;
    }

    // 3. Create a new timer
    const durationStr = args[0];
    if (!durationStr) {
      await reply(
        sock,
        msg,
        `⏳ *Timer & Reminder Command*\n\n` +
          `• *Set timer:* \`${prefix}timer <duration> [reason]\`\n` +
          `• *Examples:* \`${prefix}timer 30s\`, \`${prefix}timer 5m tea\`, \`${prefix}timer 1h30m gym\`\n` +
          `• *View active:* \`${prefix}timer list\`\n` +
          `• *Cancel timer:* \`${prefix}timer cancel <id>\``,
      );
      return;
    }

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      await reply(
        sock,
        msg,
        `❌ Invalid duration *"${durationStr}"*.\n\n` +
          `Use formats like: *30s*, *5m*, *1h*, *1h30m*, or *45* (seconds).`,
      );
      return;
    }

    // Constraints: minimum 1 second, maximum 24 hours
    if (durationMs < 1000) {
      await reply(sock, msg, '❌ Minimum timer duration is 1 second.');
      return;
    }
    if (durationMs > 24 * 3600 * 1000) {
      await reply(sock, msg, '❌ Maximum timer duration is 24 hours.');
      return;
    }

    // Enforce max 5 timers per user
    const current = userTimers.get(sender) || [];
    if (current.length >= 5) {
      await reply(
        sock,
        msg,
        `⚠️ You already have 5 active timers. Please cancel one before creating a new one using \`${prefix}timer cancel <id>\`.`,
      );
      return;
    }

    const label = args.slice(1).join(' ').trim() || 'Timer alert';
    const timerId = nextTimerId++;
    const endsAt = Date.now() + durationMs;

    const timeout = setTimeout(async () => {
      // Remove from active list
      const list = userTimers.get(sender) || [];
      const updated = list.filter((t) => t.id !== timerId);
      if (updated.length > 0) userTimers.set(sender, updated);
      else userTimers.delete(sender);

      try {
        await react(sock, msg, '⏰');
      } catch {
        /* best-effort */
      }

      try {
        await sock.sendMessage(
          msg.chat,
          {
            text:
              `⏰ *BEEP BEEP! TIME'S UP!* ⏰\n\n` +
              `🔔 *Reminder:* ${label}\n` +
              `⏱️ *Duration:* ${formatDuration(durationMs)}\n` +
              `👤 @${msg.senderNumber}`,
            mentions: [msg.sender],
          },
          { quoted: msg.raw },
        );
      } catch {
        /* chat or socket closed */
      }
    }, durationMs);

    current.push({
      id: timerId,
      label,
      durationMs,
      endsAt,
      timeout,
    });
    userTimers.set(sender, current);

    await react(sock, msg, '⏳');

    const alertTime = new Date(endsAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    await reply(
      sock,
      msg,
      `⏳ *Timer [#${timerId}] Started!*\n\n` +
        `⏱️ *Duration:* ${formatDuration(durationMs)}\n` +
        `🔔 *Reason:* ${label}\n` +
        `⏰ *Alert at:* ${alertTime}\n\n` +
        `_I will mention you when time is up!_`,
    );
  },
};

export default timerCommand;
