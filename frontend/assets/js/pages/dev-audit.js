import { api, requireRole } from '../api.js';
import { icon } from '../icons.js';
import { mountShell, pageHead } from '../shell.js';
import { $, debounce, emptyState, fmtDateTime, html, onAction, qs, render, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'audit', me);
const f = { q: qs('q') || '', action: '', operator: qs('operator') || '', role: '', from: '', to: '', page: 1 };

const ops = (await api('/dev/operators')).operators;
render(
  main,
  html`${pageHead('Audit log', 'Every significant action, who took it and when. Actions taken while impersonating are tagged.')}
  <div class="toolbar">
    <div class="search">${icon('search', 15)}<input id="q" placeholder="Search actions, people, IDs…" value="${f.q}"></div>
    <select id="action"><option value="">All actions</option></select>
    <select id="operator"><option value="">All operators</option>${ops.map((o) => html`<option value="${o.id}" ${f.operator === o.id ? 'selected' : ''}>${o.name}</option>`)}</select>
    <select id="role"><option value="">All roles</option>${['developer', 'admin', 'conductor', 'passenger', 'system'].map((r) => html`<option value="${r}">${r[0].toUpperCase() + r.slice(1)}</option>`)}</select>
    <input id="from" type="date" title="From" style="min-width:0;width:150px"><input id="to" type="date" title="To" style="min-width:0;width:150px">
  </div>
  <div class="card flush"><div id="table"></div><div class="card-foot row between" id="pager"></div></div>`,
);

let groupsLoaded = false;
async function load() {
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v != null));
  const d = await api(`/dev/audit?${p}`);
  if (!groupsLoaded) {
    groupsLoaded = true;
    for (const g of d.actionGroups) $('#action').add(new Option(g, g));
  }
  render(
    $('#table'),
    d.rows.length
      ? html`<div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Operator</th><th>Details</th></tr></thead>
        <tbody>${d.rows.map(
          (a) => html`<tr><td class="nowrap tabular">${fmtDateTime(a.created_at)}</td><td><code style="color:var(--text)">${a.action}</code></td>
            <td><div class="strong">${a.actor_label || '–'}</div><div class="sub">${a.actor_role}${a.details?.impersonated_by ? ' · impersonated' : ''}</div></td>
            <td>${a.operator_name || html`<span class="faint">–</span>`}</td>
            <td><code class="small muted" style="white-space:pre-wrap;word-break:break-all">${Object.keys(a.details || {}).length ? JSON.stringify(a.details) : ''}</code></td></tr>`,
        )}</tbody></table></div>`
      : emptyState('scroll-text', 'No matching entries', 'Try widening your filters.'),
  );
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  render(
    $('#pager'),
    html`<span>${d.total} entries · page ${d.page} of ${pages}</span>
      <span class="row"><button class="btn-sm" data-action="page" data-p="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>${icon('arrow-left', 13)} Newer</button>
      <button class="btn-sm" data-action="page" data-p="${d.page + 1}" ${d.page >= pages ? 'disabled' : ''}>Older ${icon('arrow-right', 13)}</button></span>`,
  );
}

const reload = () => { f.page = 1; load().catch(toastError); };
$('#q').addEventListener('input', debounce((e) => { f.q = e.target.value.trim(); reload(); }));
for (const k of ['action', 'operator', 'role', 'from', 'to']) $(`#${k}`).addEventListener('change', (e) => { f[k] = e.target.value; reload(); });
onAction(main, { page: (el) => { f.page = Number(el.dataset.p); load().catch(toastError); } });
load().catch(toastError);
