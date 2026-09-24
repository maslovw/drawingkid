// Settings dialog: choose which tools and colors appear on the main screen.

import { TOOLS, COLORS, SIZES } from '../config.js';
import { PROVIDERS, loadApiKeys, saveApiKey } from '../imagegen.js';

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

    q('#settings-imagegen').addEventListener('change', (e) => vm.setImageGenEnabled(e.target.checked));
    q('#settings-provider').replaceChildren(
      ...Object.entries(PROVIDERS).map(([id, p]) => choice('radio', 'provider', id, p.label, () => vm.setImageProvider(id))),
    );
    q('#settings-model').addEventListener('change', (e) => vm.setImageModel(vm.config.imageProvider, e.target.value));
    q('#settings-key').addEventListener('change', (e) => saveApiKey(vm.config.imageProvider, e.target.value.trim()));
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

    const q = (sel) => this.dialog.querySelector(sel);
    const provider = PROVIDERS[config.imageProvider];
    q('#settings-imagegen').checked = config.enableImageGen;
    for (const input of inputs('provider')) input.checked = input.value === config.imageProvider;
    q('#settings-model').value = config.imageModels[config.imageProvider];
    q('#settings-model-list').replaceChildren(...provider.models.map((m) => new Option(m, m)));
    q('#settings-key').value = loadApiKeys()[config.imageProvider] ?? '';
    q('#settings-key').placeholder = provider.keyHint;
    q('#settings-key-link').href = provider.keyUrl;
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
