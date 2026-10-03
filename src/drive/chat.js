// Multiplayer text chat on the driving HUD: recent lines fade after 10 s; the Chat key (Y)
// opens the input (Enter sends, Esc closes). Text is always inserted as plain text.
import { el } from '../ui/dom.js';

const FADE = 10000;
const KEEP = 60;

export class ChatBox {
  constructor(ui, onSend, maxLength = 200) {
    this.onSend = onSend;
    this.log = el('div', { class: 'log' });
    this.input = el('input', { type: 'text', maxlength: maxLength, placeholder: 'Say something... (Enter: send, Esc: close)' });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.input.value = '';
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('blur', () => this.close());
    this.root = el('div', { class: 'chatbox' }, [this.log, this.input]);
    ui.appendChild(this.root);
  }

  get typing() {
    return this.root.classList.contains('open');
  }

  open() {
    this.root.classList.add('open');
    setTimeout(() => this.input.focus(), 0);
  }

  close() {
    if (!this.typing) return;
    this.root.classList.remove('open');
    this.input.blur();
  }

  _line(children, cls = '') {
    const line = el('div', { class: `line ${cls}` }, children);
    this.log.append(line);
    while (this.log.children.length > KEEP) this.log.firstChild.remove();
    setTimeout(() => line.classList.add('old'), FADE);
    this.log.scrollTop = this.log.scrollHeight;
  }

  add(name, text, own = false) {
    this._line([el('b', `${name}: `), text], own ? 'own' : '');
  }

  system(text) {
    this._line([text], 'sys');
  }

  dispose() {
    this.root.remove();
  }
}
