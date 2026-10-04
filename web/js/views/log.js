// Log panel (opened from Settings): pictures made, what they cost, and every request.

import { PROVIDERS, loadApiKeys, saveApiKey, isManagedKey } from '../imagegen.js';
import { loadLog, clearLog, monthTotals, fetchOpenAISpend } from '../usagelog.js';
import { getLocale, t } from '../i18n.js';

const ADMIN = 'openaiAdmin'; // key name in the API-key store and config.local.json

const money = (usd, currency = 'USD') => {
  if (usd == null) return '—';
  const digits = usd < 1 ? 3 : 2;
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(usd);
};
const when = (date) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);

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
    this.q('#log-clear').textContent = t('log.clear');
    this.#render();
    this.dialog.showModal();
  }

  #render() {
    const log = loadLog();
    const month = monthTotals(log);
    const q = this.q;

    q('#log-images').textContent = String(log.totals.images);
    q('#log-images-month').textContent = t('log.thisMonth', { value: month.images });
    q('#log-cost').textContent = money(log.totals.costUsd);
    q('#log-cost-month').textContent =
      t('log.thisMonth', { value: money(month.costUsd) }) +
      (log.totals.unpriced ? ` · ${t('log.unpriced', { count: log.totals.unpriced })}` : '');
    q('#log-since').textContent = t('log.since', { date: when(new Date(log.since)) });

    const list = q('#log-entries');
    if (!log.entries.length) {
      const empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = t('log.empty');
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
    if (!this.spendChecked) q('#log-spend').textContent = t(key ? 'log.notChecked' : 'log.needsKey');
  }

  async #checkSpend() {
    const q = this.q;
    const button = q('#log-spend-check');
    button.disabled = true;
    q('#log-spend').textContent = t('log.asking');
    q('#log-spend-note').textContent = '';
    try {
      const { total, currency, since } = await fetchOpenAISpend(loadApiKeys()[ADMIN]);
      q('#log-spend').textContent = money(total, currency.toUpperCase());
      q('#log-spend-note').textContent = t('log.spendNote', { date: since.toLocaleDateString(getLocale(), { timeZone: 'UTC' }) });
      this.spendChecked = true;
    } catch (error) {
      q('#log-spend').textContent = t('log.couldntCheck');
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
      button.textContent = t('log.clearConfirm');
      return;
    }
    clearLog();
    this.clearArmed = false;
    button.textContent = t('log.clear');
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
  time.textContent = when(new Date(e.at));
  const cost = document.createElement('span');
  cost.className = 'log-entry-cost';
  cost.textContent = e.ok ? money(e.costUsd) : t('log.failed');
  top.append(time, cost);

  const text = document.createElement('p');
  text.className = 'log-entry-text';
  text.textContent = `“${e.text}”`; // the child's words, shown as text only

  const meta = document.createElement('p');
  meta.className = 'log-entry-meta';
  const tokens = e.usage ? ` · ${t('log.tokens', { in: e.usage.textIn + (e.usage.imageIn ?? 0), out: e.usage.out })}` : '';
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
