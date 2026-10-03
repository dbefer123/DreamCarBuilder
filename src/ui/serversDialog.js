// Multiplayer (beta) "Game servers" dialog, as in the original: the rooms on this site's game
// server (one public room per map, plus rooms players create). Joining one loads its map.
import { el } from './dom.js';
import { modal, alertBox, promptBox, listBox } from './dialogs.js';
import { MAP_LIST } from '../world/maps/list.js';

/** Ask for a player name once (Settings > Preferences can change it later). */
async function playerName(app, force = false) {
  if (app.settings.mpName && !force) return app.settings.mpName;
  const name = await promptBox(app.ui, 'Multiplayer (beta)', 'Your name (shown above your car)', app.settings.mpName || '');
  if (!name) return null;
  app.settings.mpName = name.slice(0, 24);
  app.saveSettings();
  return app.settings.mpName;
}

/** Connect, show the server list and resolve with the joined room (or null). */
export async function serversDialog(app) {
  const mp = app.mp;
  const name = await playerName(app);
  if (!name) return null;
  try {
    await mp.connect(name);
  } catch (e) {
    await alertBox(app.ui, 'Multiplayer (beta)', e.message);
    return null;
  }
  return modal(app.ui, (box, close) => {
    const list = el('div', { class: 'list servers' });
    const status = el('div', { class: 'meta mp-status' });
    const render = (rooms) => {
      list.replaceChildren();
      if (!rooms.length) list.append(el('p', 'The list is empty'));
      for (const r of rooms) {
        list.append(el('div', { class: `li ${mp.room?.id === r.id ? 'cur' : ''}`, onclick: () => join(r) }, [
          el('div', [el('div', r.name), el('div', { class: 'meta' }, `${r.mapName} · ${r.players} / ${r.max} players${mp.room?.id === r.id ? ' · you are here' : ''}`)]),
        ]));
      }
    };
    const update = async () => {
      status.textContent = 'Updating...';
      try {
        render(await mp.list());
        status.textContent = `Playing as ${mp.name}`;
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const join = async (r) => {
      if (mp.room?.id === r.id) return close(mp.room);
      status.textContent = `Joining ${r.name}...`;
      try {
        close(await mp.join(r.id));
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const create = async () => {
      const roomName = await promptBox(app.ui, 'Create server', 'Server name', `${mp.name}'s server`);
      if (!roomName) return;
      const map = await listBox(app.ui, 'Map of the server', MAP_LIST.map((m) => ({ label: m.label, value: m.key })));
      if (!map) return;
      status.textContent = 'Creating...';
      try {
        close(await mp.create(roomName, map));
      } catch (e) {
        status.textContent = e.message;
      }
    };
    box.classList.add('servers-dialog');
    box.append(
      el('h2', 'Game servers'),
      list,
      status,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn outline', onclick: () => close(null) }, 'Back'),
        el('button', { class: 'btn outline', onclick: async () => { const n = await playerName(app, true); if (n) { mp.disconnect(); await mp.connect(n); update(); } } }, 'Name...'),
        el('button', { class: 'btn green', onclick: create }, 'Create server...'),
        el('button', { class: 'btn', onclick: update }, 'Update'),
      ]),
    );
    update();
  });
}

/** Drive on a room's map with the Sandbox car (multiplayer upgrades are free). */
export async function enterRoom(app, room) {
  if (app.mode !== 'sandbox') app.setMode('sandbox');
  const world = await app.loadWorld(room.map, undefined, { remember: false });
  const { DriveScreen } = await import('../drive/drive.js');
  await app.setScreen(new DriveScreen(app, world, {}));
}
