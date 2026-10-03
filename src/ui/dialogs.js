// Modal dialogs: generic modal, alert, confirm, prompt and list (Settings: settingsDialog.js).
import { el } from './dom.js';

let openCount = 0;
export function isModalOpen() {
  return openCount > 0;
}

export function modal(ui, contentBuilder, opts = {}) {
  return new Promise((resolve) => {
    openCount++;
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      openCount--;
      shade.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const box = el('div', { class: `dialog ${opts.class || ''}` });
    const shade = el('div', { class: 'modal-shade' }, [box]);
    shade.addEventListener('pointerdown', (e) => {
      if (e.target === shade && opts.dismissable !== false) close(null);
    });
    const onKey = (e) => {
      // dialogs that capture keys (Settings > Controls) mark the box while waiting for one
      if (e.key === 'Escape' && !box.dataset.capturing) {
        e.stopPropagation();
        e.preventDefault();
        close(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    contentBuilder(box, close);
    ui.appendChild(shade);
    const first = box.querySelector('input,select');
    if (first && opts.focus !== false) setTimeout(() => first.focus(), 0);
  });
}

export function alertBox(ui, title, text) {
  return modal(ui, (box, close) => {
    box.append(el('h2', title), el('p', { html: text }), el('div', { class: 'row' }, [el('button', { class: 'btn', onclick: () => close(true) }, 'OK')]));
  });
}

export function confirmBox(ui, title, text, okLabel = 'OK', danger = false) {
  return modal(ui, (box, close) => {
    box.append(
      el('h2', title),
      el('p', text),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn outline', onclick: () => close(false) }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'red' : ''}`, onclick: () => close(true) }, okLabel),
      ]),
    );
  });
}

export function promptBox(ui, title, label, value = '') {
  return modal(ui, (box, close) => {
    const input = el('input', { type: 'text', value });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value.trim() || null);
    });
    box.append(
      el('h2', title),
      el('div', { class: 'form' }, [el('label', label), input]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn outline', onclick: () => close(null) }, 'Cancel'),
        el('button', { class: 'btn', onclick: () => close(input.value.trim() || null) }, 'OK'),
      ]),
    );
  });
}

export function listBox(ui, title, items, opts = {}) {
  return modal(ui, (box, close) => {
    box.append(el('h2', title));
    if (!items.length) box.append(el('p', opts.empty || 'Nothing here yet.'));
    const list = el('div', { class: 'list' });
    for (const it of items) {
      const row = el('div', { class: 'li', onclick: () => close(it.value) }, [
        el('div', [el('div', it.label), it.meta ? el('div', { class: 'meta' }, it.meta) : null]),
        opts.onDelete ? el('span', {
          class: 'x',
          title: 'Delete',
          onclick: (e) => {
            e.stopPropagation();
            opts.onDelete(it.value);
            row.remove();
          },
        }, '✕') : null,
      ]);
      list.append(row);
    }
    box.append(list, el('div', { class: 'row' }, [el('button', { class: 'btn outline', onclick: () => close(null) }, 'Close')]));
  });
}
