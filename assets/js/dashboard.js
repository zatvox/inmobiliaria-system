import { initShell } from './main.js';
import { getDashboardKpis } from './supabase-data.js';
import { showToast, ESTADO_LABELS, formatCurrency } from './utils.js';

async function main() {
  const profile = await initShell('dashboard');
  if (!profile) return;

  try {
    const kpis = await getDashboardKpis();
    const cards = document.querySelectorAll('#kpi-grid .kpi-card');
    const values = [kpis.totalPropiedades, kpis.totalSecciones, kpis.totalPersonas, kpis.contratosVigentes, formatCurrency(kpis.montoPendiente)];
    cards.forEach((card, i) => {
      const valueEl = card.querySelector('.kpi-value');
      valueEl.classList.remove('skeleton');
      valueEl.style.height = '';
      valueEl.textContent = values[i] ?? 0;
    });
    if (kpis.contratosPorVencer > 0) {
      cards[3].classList.add('accent-warning');
      const sub = document.createElement('div');
      sub.className = 'kpi-sub';
      sub.textContent = `${kpis.contratosPorVencer} por vencer`;
      cards[3].append(sub);
    }
    if (kpis.cuotasVencidas > 0) {
      cards[4].classList.add('accent-danger');
      const sub = document.createElement('div');
      sub.className = 'kpi-sub';
      sub.textContent = `${kpis.cuotasVencidas} vencida(s)`;
      cards[4].append(sub);
    }

    const breakdown = document.getElementById('estado-breakdown');
    breakdown.innerHTML = '';
    const entries = Object.entries(kpis.seccionesPorEstado);
    if (!entries.length) {
      breakdown.innerHTML = '<span style="color:var(--gray-500);">Aún no hay secciones registradas.</span>';
    } else {
      entries.forEach(([estado, count]) => {
        const chip = document.createElement('span');
        chip.className = `badge badge-${estado}`;
        chip.textContent = `${ESTADO_LABELS[estado] ?? estado}: ${count}`;
        breakdown.append(chip);
      });
    }
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el dashboard. Revisa la conexión con Supabase (config.js).', 'error');
  }
}

main();
