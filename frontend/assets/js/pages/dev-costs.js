import { api, requireRole } from '../api.js';
import { mountShell, pageHead } from '../shell.js';
import { badge, html, money, num, pkgBadge, render, toastError } from '../ui.js';

const me = await requireRole('developer');
const main = mountShell('developer', 'costs', me);

const d = await api('/dev/costs').catch(toastError);
const t = d.totals;
const revenue = t.packageRevenue + t.passengerRevenue;
render(
  main,
  html`${pageHead('Costs', html`Last 30 days. Messaging is estimated at Rs ${d.assumptions.costPerMessagePkr} per message and infrastructure from the business model at Rs ${d.assumptions.pkrPerUsd}/USD. <a class="link" href="/dev/settings">Change rates</a>`)}
  <div class="stats">
    <div class="stat"><div class="label">Revenue</div><div class="value">${money(revenue)}</div><div class="hint">${money(t.packageRevenue)} plans · ${money(t.passengerRevenue)} passengers</div></div>
    <div class="stat"><div class="label">Messaging</div><div class="value">${money(t.messagingCost)}</div><div class="hint">${num(t.messages)} messages</div></div>
    <div class="stat"><div class="label">Infrastructure</div><div class="value">${money(t.infraPkr)}</div><div class="hint">≈ $${t.infraUsd} / month</div></div>
    <div class="stat"><div class="label">Gross margin</div><div class="value">${money(t.grossMarginPkr)}</div><div class="hint">${revenue ? Math.round((t.grossMarginPkr / revenue) * 100) : 0}% of revenue</div></div>
  </div>
  <div class="card flush"><div class="table-wrap"><table>
    <thead><tr><th>Operator</th><th>Plan</th><th class="num">Subscribers</th><th class="num">Messages</th><th class="num">GPS pings</th><th class="num">Messaging cost</th><th class="num">Plan revenue</th><th class="num">Passenger revenue</th></tr></thead>
    <tbody>${d.rows.map(
      (r) => html`<tr><td class="strong">${r.name} ${r.status !== 'active' ? badge(r.status) : ''}</td><td>${pkgBadge(r.package)}</td><td class="num">${r.active_subscribers}</td><td class="num">${num(r.messages_30d)}</td><td class="num">${num(r.pings_30d)}</td>
        <td class="num">${money(r.messaging_cost_pkr)}</td><td class="num">${money(r.package_revenue_pkr)}</td><td class="num">${money(r.passenger_revenue_30d)}</td></tr>`,
    )}</tbody>
  </table></div><div class="card-foot">${d.assumptions.note}</div></div>`,
);
