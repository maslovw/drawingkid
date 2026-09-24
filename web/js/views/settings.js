// Settings dialog: choose which tools and colors appear on the main screen.

import { TOOLS, COLORS, SIZES } from '../config.js';
import { PROVIDERS, loadApiKeys, saveApiKey, knownModels, refreshModels, isManagedKey } from '../imagegen.js';

export class SettingsView {
  constructor(dialog, vm) {
    this.dialog = dialog;
    this.vm = vm;
    this.#build();
    vm.addEventListener('change', () => this.#sync());
    this.#sync();
  }

  open() {
    this.dialog.querySelector('#settings-model-status').textContent = '';
    this.#sync();
    this.dialog.showModal();
  }

  // Options: known models for this provider, plus the saved choice if it isn't among them.
  #fillModels() {
    const { imageProvider, imageModels } = this.vm.config;
    const current = imageModels[imageProvider];
    const models = knownModels(imageProvider);
    const select = this.dialog.querySelector('#settings-model');
    select.replaceChildren(...[...new Set([...models, current])].map((m) => new Option(m, m)));
    select.value = current;
  }

  async #refreshModels() {
    if (this.vm.isManaged('imageModels', this.vm.config.imageProvider)) return;
    const q = (sel) => this.dialog.querySelector(sel);
    const provider = this.vm.config.imageProvider;
    const key = isManagedKey(provider) ? loadApiKeys()[provider] : q('#settings-key').value.trim();
    const button = q('#settings-refresh');
    const status = q('#settings-model-status');
    button.disabled = true;
    status.textContent = `Asking ${PROVIDERS[provider].label} for its image models…`;
    try {
      const models = await refreshModels(provider, key);
      saveApiKey(provider, key);
      if (this.vm.config.imageProvider !== provider) return; // switched provider meanwhile
      this.#fillModels();
      status.textContent = `Found ${models.length} image model${models.length === 1 ? '' : 's'}. Pick one from the list.`;
      const select = q('#settings-model');
      select.focus();
      try {
        select.showPicker(); // open the list right away where the browser allows it
      } catch {
        // Not supported, or the click's user activation has expired.
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
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
    q('#settings-lefty').addEventListener('change', (e) => vm.setLeftHanded(e.target.checked));

    q('#settings-imagegen').addEventListener('change', (e) => vm.setImageGenEnabled(e.target.checked));
    q('#settings-provider').replaceChildren(
      ...Object.entries(PROVIDERS).map(([id, p]) => choice('radio', 'provider', id, p.label, () => vm.setImageProvider(id))),
    );
    q('#settings-model').addEventListener('change', (e) => vm.setImageModel(vm.config.imageProvider, e.target.value));
    q('#settings-key').addEventListener('change', (e) => saveApiKey(vm.config.imageProvider, e.target.value.trim()));
    q('#settings-refresh').addEventListener('click', () => this.#refreshModels());
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
    for (const el of this.dialog.querySelectorAll('input[name="size"], input[name="provider"], #settings-lefty, #settings-imagegen, #settings-key, #settings-model, #settings-refresh')) {
      el.disabled = false;
    }
    this.dialog.querySelector('#settings-lefty').checked = config.leftHanded;

    const q = (sel) => this.dialog.querySelector(sel);
    const provider = PROVIDERS[config.imageProvider];
    q('#settings-imagegen').checked = config.enableImageGen;
    for (const input of inputs('provider')) input.checked = input.value === config.imageProvider;
    this.#fillModels();
    q('#settings-key').value = loadApiKeys()[config.imageProvider] ?? '';
    q('#settings-key').placeholder = provider.keyHint;
    q('#settings-key-link').href = provider.keyUrl;
    this.#lockManaged();
  }

  // Controls for settings fixed by config.local.json are shown but locked.
  #lockManaged() {
    const { vm } = this;
    const q = (sel) => this.dialog.querySelector(sel);
    const inputs = (name) => [...this.dialog.querySelectorAll(`input[name="${name}"]`)];
    const lock = (els, managed) => {
      for (const el of els) {
        if (managed) el.disabled = true;
        el.closest('.choice')?.classList.toggle('managed', managed);
      }
    };
    const provider = vm.config.imageProvider;
    lock(inputs('tools'), vm.isManaged('visibleTools'));
    lock(inputs('colors'), vm.isManaged('visibleColors'));
    lock(inputs('size'), vm.isManaged('defaultSize'));
    lock([q('#settings-lefty')], vm.isManaged('leftHanded'));
    lock([q('#settings-imagegen')], vm.isManaged('enableImageGen'));
    lock(inputs('provider'), vm.isManaged('imageProvider'));
    const modelManaged = vm.isManaged('imageModels', provider);
    q('#settings-model').disabled = modelManaged;
    q('#settings-refresh').disabled = modelManaged;
    const keyManaged = isManagedKey(provider);
    q('#settings-key').disabled = keyManaged;
    if (keyManaged) q('#settings-key').value = '••••••••••••';
    const anyManaged = Object.keys(vm.managed).length > 0 || Object.keys(PROVIDERS).some(isManagedKey);
    q('#settings-managed').hidden = !anyManaged;
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
