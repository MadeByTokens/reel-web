// The sticker picker. Stickers are emoji, drawn with the device's own emoji
// font: hundreds of pictures with nothing to download or license.

import { el } from '../editor';

const GROUPS: [string, string][] = [
  ['Faces', '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 😐 😏 🙄 😴 🤒 🥳 😎 🤓 😮 😲 😳 🥺 😢 😭 😱 😤 😡 🤯 😈 👻 💀 👽 🤖 💩'],
  ['People', '👋 ✋ 👌 ✌️ 🤞 🤟 🤘 👈 👉 👆 👇 👍 👎 ✊ 👏 🙌 🙏 💪 👀 🧠 👶 🧒 👦 👧 🧑 👨 👩 🧓 🦸 🧙 🧚 🧜 🧛 🥷 👑 🎩 🎓 👓 🕶️ 💃 🕺 🏃'],
  ['Animals', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦖 🦕 🐙 🦀 🐠 🐬 🐳 🦈 🐘 🦒 🐎 🐑 🐕 🐈 🐉'],
  ['Nature', '🌵 🎄 🌲 🌳 🌴 🌱 🍀 🍁 🍂 🌷 🌹 🌻 🌼 🌞 🌝 🌛 ⭐ 🌟 ✨ ⚡ 🔥 💥 ☄️ 🌈 ☀️ ⛅ ☁️ 🌧️ ⛄ ❄️ 💧 🌊 🌍 🪐'],
  ['Food', '🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥑 🥕 🌽 🍞 🧀 🥚 🥓 🥞 🍔 🍟 🍕 🌭 🌮 🍝 🍣 🍦 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍿 🥤 🧃 ☕'],
  ['Play', '⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🥅 ⛳ 🥊 🛹 🎿 🏆 🥇 🥈 🥉 🎮 🕹️ 🎲 🧩 🎯 🎳 🎨 🎬 🎤 🎧 🎹 🥁 🎸 🎺 🎻 🎪 🎭'],
  ['Things', '🚗 🚕 🚌 🚓 🚑 🚒 🚜 🚲 🏍️ ✈️ 🚀 🛸 🚁 ⛵ 🚂 🏠 🏰 ⛺ 🎡 🎢 📱 💻 📷 🎥 📺 💡 🔦 📚 ✏️ 🔑 🔨 🧲 🎁 🎈 🎉 🎊 💎 💰 ⏰ 🔔'],
  ['Signs', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💯 ✅ ❌ ❓ ❗ ⚠️ 🚫 ⬆️ ⬇️ ⬅️ ➡️ ↗️ ↘️ ↙️ ↖️ 🔄 ➕ ➖ 💬 💭 💤 🎵 🎶 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻'],
];

export interface StickerPicker {
  /** Opens the picker; resolves with the chosen sticker, or null when closed. */
  pick(): Promise<string | null>;
}

export function installStickers(): StickerPicker {
  const dialog = el<HTMLDivElement>('stickers');
  const tabs = el<HTMLDivElement>('sticker-tabs');
  const grid = el<HTMLDivElement>('sticker-grid');
  let done: ((value: string | null) => void) | null = null;

  const close = (value: string | null): void => {
    dialog.hidden = true;
    done?.(value);
    done = null;
  };

  const tabButtons = GROUPS.map(([name, glyphs], index) => {
    const tab = document.createElement('button');
    tab.textContent = name;
    tab.setAttribute('role', 'tab');
    tab.addEventListener('click', () => showGroup(index));
    tabs.append(tab);
    return { tab, glyphs: glyphs.split(' ') };
  });

  function showGroup(index: number): void {
    tabButtons.forEach(({ tab }, i) => tab.setAttribute('aria-selected', String(i === index)));
    grid.replaceChildren(
      ...tabButtons[index]!.glyphs.map((glyph) => {
        const b = document.createElement('button');
        b.textContent = glyph;
        b.setAttribute('aria-label', `Sticker ${glyph}`);
        b.addEventListener('click', () => close(glyph));
        return b;
      }),
    );
    grid.scrollTop = 0;
  }

  el('sticker-cancel').addEventListener('click', () => close(null));
  showGroup(0);

  return {
    pick() {
      done?.(null);
      return new Promise((resolve) => {
        done = resolve;
        dialog.hidden = false;
      });
    },
  };
}
