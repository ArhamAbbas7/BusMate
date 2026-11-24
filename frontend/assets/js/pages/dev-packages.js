import { api, requireRole } from '../api.js';
import { mountShell, pageHead } from '../shell.js';
import { html, money, render, toast, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'packages', me);
const PKGS = ['basic', 'premium', 'gold'];

async function load() {
  const d = await api('/dev/packages');
  render(
    main,
    html`${pageHead('Packages', 'Plan defaults for every operator. Changes save instantly. Use operator overrides for one-off exceptions.')}
    <div class="card flush"><div class="table-wrap"><table class="matrix">
      <thead><tr><th>Feature</th>${PKGS.map((p) => html`<th style="width:180px"><div class="strong" style="color:var(--text);text-transform:capitalize;font-size:13.5px">${p}</div><div class="sub" style="font-weight:400">${money(d.prices[p])} / month</div></th>`)}</tr></thead>
      <tbody>
        ${Object.entries(d.featureInfo).map(
          ([k, info]) => html`<tr><td><span class="strong">${info.label}</span>${info.future ? html` <span class="badge plain gray">Future</span>` : ''}<div class="sub mono">${k}</div></td>
          ${PKGS.map((p) => {
            const v = d.matrix[k]?.[p];
            if (info.type === 'bool') return html`<td><label class="switch" style="margin:0"><input type="checkbox" data-pkg="${p}" data-key="${k}" data-type="bool" ${v ? 'checked' : ''}><span></span></label></td>`;
            if (info.type === 'limit') return html`<td><input type="number" min="0" data-pkg="${p}" data-key="${k}" data-type="limit" value="${v ?? ''}" placeholder="∞"></td>`;
            return html`<td><input type="text" data-pkg="${p}" data-key="${k}" data-type="text" value="${v ?? ''}"></td>`;
          })}</tr>`,
        )}
      </tbody>
    </table></div>
    <div class="card-foot">Empty limit means unlimited. Features marked <i>Future</i> are flags only for now.</div></div>`,
  );
}

main.addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.dataset.key) return;
  const t = el.dataset.type;
  const value = t === 'bool' ? el.checked : t === 'limit' ? (el.value === '' ? null : Number(el.value)) : el.value;
  try {
    await api(`/dev/packages/${el.dataset.pkg}/${el.dataset.key}`, { method: 'PUT', body: { value } });
    toast(`Saved ${el.dataset.pkg} · ${el.dataset.key.replace(/_/g, ' ')}`);
  } catch (err) {
    toastError(err);
    load();
  }
});

load().catch(toastError);
