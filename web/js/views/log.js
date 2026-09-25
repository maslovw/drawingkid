// Log panel (opened from Settings): pictures made, what they cost, and every request.

import { PROVIDERS, loadApiKeys, saveApiKey, isManagedKey } from '../imagegen.js';
import { loadLog, clearLog, monthTotals, fetchOpenAISpend } from '../usagelog.js';

const ADMIN = 'openaiAdmin'; // key name in the API-key store and config.local.json

const money = (usd) => (usd == null ? '—' : `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`);
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export class LogView {
  constructor(dialog) {
    this.dialog = dialog;
    const q = (sel) => dialog.querySelector(sel);
    this.q = q;
    q('#log-spend-check').addEventListener('click', () => this.#checkSpend());
    q('#log-admin-key').addEventListener('change', (e) => {
      saveApiKey(ADMIN, e.target.value.trim());
      this.#renderSpend();
    });
    q('#log-clear').addEventListener('click', () => this.#clear());
    q('#log-close').addEventListener('click', () => dialog.close());
  }

  open() {
    this.clearArmed = false;
    this.q('#log-clear').textContent = 'Clear log';
    this.#render();
    this.dialog.showModal();
  }

  #render() {
    const log = loadLog();
    const month = monthTotals(log);
    const q = this.q;

    q('#log-images').textContent = String(log.totals.images);
    q('#log-images-month').textContent = `${month.images} this month`;
    q('#log-cost').textContent = money(log.totals.costUsd);
    q('#log-cost-month').textContent =
      `${money(month.costUsd)} this month` + (log.totals.unpriced ? ` · ${log.totals.unpriced} without a known price` : '');
    q('#log-since').textContent = `Counting since ${when.format(new Date(log.since))} on this device.`;

    const list = q('#log-entries');
    if (!log.entries.length) {
      const empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = 'No coloring pages yet.';
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...log.entries.map(entryRow));
    }
    this.#renderSpend();
  }

  #renderSpend() {
    const q = this.q;
    const managed = isManagedKey(ADMIN);
    const key = loadApiKeys()[ADMIN] ?? '';
    const input = q('#log-admin-key');
    input.disabled = managed;
    input.value = managed ? '••••••••••••' : key;
    q('#log-admin-managed').hidden = !managed;
    q('#log-spend-check').disabled = !key;
    if (!this.spendChecked) q('#log-spend').textContent = key ? 'Not checked yet' : 'Needs an admin key';
  }

  async #checkSpend() {
    const q = this.q;
    const button = q('#log-spend-check');
    button.disabled = true;
    q('#log-spend').textContent = 'Asking OpenAI…';
    q('#log-spend-note').textContent = '';
    try {
      const { total, currency, since } = await fetchOpenAISpend(loadApiKeys()[ADMIN]);
      q('#log-spend').textContent = currency.toLowerCase() === 'usd' ? money(total) : `${total.toFixed(2)} ${currency.toUpperCase()}`;
      q('#log-spend-note').textContent = `Whole OpenAI organization, since ${since.toLocaleDateString()} (UTC). OpenAI updates costs with a delay of up to a day.`;
      this.spendChecked = true;
    } catch (error) {
      q('#log-spend').textContent = 'Couldn’t check';
      q('#log-spend-note').textContent = error.message;
    } finally {
      button.disabled = !loadApiKeys()[ADMIN];
    }
  }

  // Two taps: the first arms the button, the second clears.
  #clear() {
    const button = this.q('#log-clear');
    if (!this.clearArmed) {
      this.clearArmed = true;
      button.textContent = 'Tap again to clear the log';
      return;
    }
    clearLog();
    this.clearArmed = false;
    button.textContent = 'Clear log';
    this.#render();
  }
}

function entryRow(e) {
  const li = document.createElement('li');
  li.className = `log-entry${e.ok ? '' : ' failed'}`;

  const top = document.createElement('div');
  top.className = 'log-entry-top';
  const time = document.createElement('time');
  time.dateTime = e.at;
  time.textContent = when.format(new Date(e.at));
  const cost = document.createElement('span');
  cost.className = 'log-entry-cost';
  cost.textContent = e.ok ? money(e.costUsd) : 'failed';
  top.append(time, cost);

  const text = document.createElement('p');
  text.className = 'log-entry-text';
  text.textContent = `“${e.text}”`; // the child's words, shown as text only

  const meta = document.createElement('p');
  meta.className = 'log-entry-meta';
  const tokens = e.usage ? ` · ${e.usage.textIn + (e.usage.imageIn ?? 0)} in / ${e.usage.out} out tokens` : '';
  meta.textContent = `${PROVIDERS[e.provider]?.label ?? e.provider} · ${e.model}${tokens}`;
  li.append(top, text, meta);

  if (!e.ok && e.error) {
    const error = document.createElement('p');
    error.className = 'log-entry-error';
    error.textContent = e.error;
    li.append(error);
  }
  return li;
}
