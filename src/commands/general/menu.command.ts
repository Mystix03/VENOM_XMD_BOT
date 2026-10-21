import fs from 'fs';
import path from 'path';
import type { Command } from '../../types/command.type';
import { commandsByCategory } from '../index';
import { reply, sendReplyContent } from '../../services/message.service';
import { env, META } from '../../config';
import { formatUptime } from '../../utils/helpers';

interface CategoryMeta {
  label: string;
  icon: string;
  aliases?: string[];
}

const CATEGORY_META: Record<string, CategoryMeta> = {
  general: { label: 'General & Info', icon: '🌐', aliases: ['gen', 'main', 'info'] },
  ai: { label: 'AI & Intelligence', icon: '🤖', aliases: ['chatgpt', 'gpt', 'botai'] },
  downloader: { label: 'Downloader', icon: '📥', aliases: ['dl', 'download', 'downloads'] },
  tools: { label: 'Tools & Utilities', icon: '🛠️', aliases: ['tool', 'util', 'utils'] },
  group: { label: 'Group Management', icon: '👥', aliases: ['admin', 'gc', 'groups'] },
  media: { label: 'Media & Audio', icon: '🎬', aliases: ['audio', 'video'] },
  anime: { label: 'Anime & Manga', icon: '🌸', aliases: ['weeb', 'manga'] },
  image: { label: 'Image & Photo', icon: '🖼️', aliases: ['img', 'photo', 'photos'] },
  game: { label: 'Games & Play', icon: '🎮', aliases: ['games', 'play'] },
  fun: { label: 'Fun & Entertainment', icon: '🎉', aliases: ['jokes', 'meme', 'memes'] },
  economy: { label: 'Economy & Wallet', icon: '💰', aliases: ['eco', 'wallet', 'vtu'] },
  search: { label: 'Search & Lookup', icon: '🔍', aliases: ['find'] },
  converter: { label: 'Converter', icon: '🔄', aliases: ['convert'] },
  textmaker: { label: 'Text Effects', icon: '✍️', aliases: ['text', 'font', 'fonts'] },
  user: { label: 'User & Profile', icon: '👤', aliases: ['profile'] },
  bot: { label: 'Bot Settings', icon: '⚡', aliases: ['settings', 'botsettings'] },
  config: { label: 'Configuration', icon: '⚙️', aliases: ['cfg'] },
  owner: { label: 'Owner & Sudo', icon: '👑', aliases: ['sudo', 'dev'] },
};

const CATEGORY_ORDER = [
  'general',
  'ai',
  'downloader',
  'tools',
  'group',
  'media',
  'anime',
  'image',
  'game',
  'fun',
  'economy',
  'search',
  'converter',
  'textmaker',
  'user',
  'bot',
  'config',
  'owner',
];

/**
 * Resolve the menu banner image. Prefers the bundled assets/logo.png (works
 * fully offline), otherwise falls back to the configured MENU_IMAGE_URL.
 */
function resolveMenuImage(): Buffer | { url: string } | null {
  const candidates = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.resolve(__dirname, '../../../assets/logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      /* ignore and try next */
    }
  }
  return env.menuImage ? { url: env.menuImage } : null;
}

function matchCategoryKey(query: string, available: string[]): string | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;

  // Exact category name match
  if (available.includes(q)) return q;

  // Check aliases or exact label matches
  for (const cat of available) {
    const meta = CATEGORY_META[cat];
    if (!meta) continue;
    if (meta.label.toLowerCase() === q) return cat;
    if (meta.aliases?.some((a) => a === q)) return cat;
  }

  // Prefix match
  return available.find(
    (cat) => cat.startsWith(q) || CATEGORY_META[cat]?.label.toLowerCase().includes(q),
  );
}

const menu: Command = {
  name: 'menu',
  aliases: ['m', 'list', 'help all'],
  category: 'general',
  description: 'Display bot command categories or view a specific category.',
  usage: 'menu [category|all]',
  async run({ sock, msg, args, prefix }) {
    const grouped = commandsByCategory();
    const availableCategories = CATEGORY_ORDER.filter(
      (cat) => grouped[cat]?.length > 0,
    );

    // Also include any dynamically discovered category not in the pre-defined order
    for (const cat of Object.keys(grouped)) {
      if (!availableCategories.includes(cat) && grouped[cat]?.length > 0) {
        availableCategories.push(cat);
      }
    }

    let totalCommands = 0;
    for (const list of Object.values(grouped)) {
      totalCommands += list.length;
    }

    const sub = (args[0] || '').trim().toLowerCase();

    // ─────────────────────────────────────────────────────────────
    // 1. ALL COMMANDS VIEW (.menu all)
    // ─────────────────────────────────────────────────────────────
    if (sub === 'all') {
      const header = [
        `╭─「 *${env.botName}* • All Commands 」`,
        `│ ⚡ Version: v${META.version}`,
        `│ ⏱️ Uptime: ${formatUptime(process.uptime())}`,
        `│ 📦 Total: ${totalCommands} commands across ${availableCategories.length} categories`,
        `│ 🔧 Prefix: "${prefix}"`,
        `╰────────────────────────`,
        '',
      ];

      const sections: string[] = [];
      for (const category of availableCategories) {
        const cmds = grouped[category];
        if (!cmds?.length) continue;
        const meta = CATEGORY_META[category] || {
          label: category.toUpperCase(),
          icon: '📁',
        };

        sections.push(`*╭─「 ${meta.icon} ${meta.label.toUpperCase()} (${cmds.length}) 」*`);
        const sorted = cmds.sort((a, b) => a.name.localeCompare(b.name));
        const formatted = sorted.map((c) => `${prefix}${c.name}`);

        // Group into neat rows of 3 commands per line for a clean, compact view
        for (let i = 0; i < formatted.length; i += 3) {
          sections.push(`│ ${formatted.slice(i, i + 3).join('  •  ')}`);
        }
        sections.push('*╰────────────────────────*', '');
      }

      const caption = [...header, ...sections].join('\n').trim();
      const image = resolveMenuImage();
      if (image) {
        try {
          await sendReplyContent(sock, msg, { image, caption });
          return;
        } catch {
          /* fall back to text-only */
        }
      }
      await reply(sock, msg, caption);
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // 2. SPECIFIC CATEGORY VIEW (.menu <category>)
    // ─────────────────────────────────────────────────────────────
    if (sub) {
      const matched = matchCategoryKey(sub, availableCategories);

      if (!matched) {
        const validList = availableCategories
          .map((cat) => `\`${cat}\``)
          .join(', ');
        await reply(
          sock,
          msg,
          `❌ Category *"${sub}"* not found.\n\n📂 *Available Categories:*\n${validList}\n\n💡 Type *${prefix}menu* to view the category directory.`,
        );
        return;
      }

      const cmds = (grouped[matched] || []).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const meta = CATEGORY_META[matched] || {
        label: matched.toUpperCase(),
        icon: '📁',
      };

      const lines = [
        `╭─「 ${meta.icon} *${meta.label.toUpperCase()}* 」`,
        `│ 📦 Commands: ${cmds.length}`,
        `│ 💡 Type *${prefix}help <command>* for usage details`,
        `╰────────────────────────`,
        '',
        ...cmds.map((c) => {
          const desc = c.description ? ` — _${c.description}_` : '';
          return `│ • *${prefix}${c.name}*${desc}`;
        }),
        '',
        `╰─ 💡 Type *${prefix}menu* for all categories`,
      ];

      await reply(sock, msg, lines.join('\n'));
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // 3. CATEGORY DIRECTORY INDEX VIEW (default: .menu)
    // ─────────────────────────────────────────────────────────────
    const header = [
      `╭─「 *${env.botName}* 」`,
      `│ ⚡ Version: v${META.version}`,
      `│ ⏱️ Uptime: ${formatUptime(process.uptime())}`,
      `│ 📦 Total Commands: ${totalCommands}`,
      `│ 🔧 Prefix: "${prefix}"`,
      `╰────────────────────────`,
      '',
      `╭─「 *COMMAND CATEGORIES* 」`,
    ];

    const categoryLines = availableCategories.map((cat) => {
      const count = grouped[cat]?.length || 0;
      const meta = CATEGORY_META[cat] || {
        label: cat.toUpperCase(),
        icon: '📁',
      };
      return `│ ${meta.icon} *${meta.label}* (${count})  ➜  \`${prefix}menu ${cat}\``;
    });

    const footer = [
      `╰────────────────────────`,
      '',
      `💡 *Navigation:*`,
      `• Type *${prefix}menu <category>* to browse (e.g. *${prefix}menu ai*)`,
      `• Type *${prefix}menu all* to view the complete list`,
      `• Type *${prefix}help <command>* for command details`,
    ];

    const caption = [...header, ...categoryLines, ...footer].join('\n');

    const image = resolveMenuImage();
    if (image) {
      try {
        await sendReplyContent(sock, msg, { image, caption });
        return;
      } catch {
        /* fall back to text-only */
      }
    }

    await reply(sock, msg, caption);
  },
};

export default menu;
