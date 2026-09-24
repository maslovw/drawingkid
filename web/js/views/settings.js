// Settings dialog: choose which tools and colors appear on the main screen.

import { TOOLS, COLORS, SIZES } from '../config.js';

export class SettingsView {
  constructor(dialog, vm) {
    this.dialog = dialog;
    this.vm = vm;
    this.#build();
    vm.addEventListener('change', () => this.#sync());
    this.#sync();
  }

  open() {
    this.#sync();
    this.dialog.showModal();
  }

  #build() {
    const { vm, dialog } = this;
    const q = (sel) => dialog.querySelector(sel);

    q('#settings-tools').replaceChildren(
      ...TOOLS.map((t) =>
        choice('checkbox', 'tools', t.id, `<span class="icon" aria-hidden="true">${t.icon}</span>${t.label}`, (on) =>
          vm.setToolVisible(t.id, on),
        ),
      ),
    );
    q('#settings-colors').replaceChildren(
      ...COLORS.map((c) =>
        choice(
          'checkbox',
          'colors',
          c.id,
          `<span class="swatch-preview" style="background:${c.value}"></span>${c.label}`,
          (on) => vm.setColorVisible(c.id, on),
        ),
      ),
    );
    q('#settings-size').replaceChildren(
      ...SIZES.map((s) => choice('radio', 'size', s.id, s.label, () => vm.setDefaultSize(s.id))),
    );
    q('#settings-ai').addEventListener('change', (e) => vm.setAIEnabled(e.target.checked));
    q('#settings-reset').addEventListener('click', () => vm.resetConfig());
  }

  #sync() {
    const { config } = this.vm;
    const inputs = (name) => [...this.dialog.querySelectorAll(`input[name="${name}"]`)];

    // Checking state plus: the last visible tool/color can't be unchecked.
    for (const [name, visible] of [
      ['tools', config.visibleTools],
      ['colors', config.visibleColors],
    ]) {
      for (const input of inputs(name)) {
        input.checked = visible.includes(input.value);
        input.disabled = input.checked && visible.length === 1;
      }
    }
    for (const input of inputs('size')) input.checked = input.value === config.defaultSize;
    this.dialog.querySelector('#settings-ai').checked = config.enableAI;
  }
}

function choice(type, name, value, html, onChange) {
  const label = document.createElement('label');
  label.className = 'choice';
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.addEventListener('change', () => onChange(input.checked));
  const text = document.createElement('span');
  text.className = 'choice-body';
  text.innerHTML = html;
  label.append(input, text);
  return label;
}
