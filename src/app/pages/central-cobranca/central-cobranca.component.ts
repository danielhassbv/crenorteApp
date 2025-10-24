import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CobrancaDataService } from '../../services/cobranca-data.service';
import type { GrupoDoc, ParcelaDoc } from '../../models/cobranca.model';
import { Timestamp } from 'firebase/firestore';

type IntegranteForm = { id?: string; nome: string; telefone1?: string; telefone2?: string; valorIndividual?: number };
type ParcelaForm = { id?: string; parcela: number; valorParcela: number; vencimento: string | Date; pago?: boolean };

type GrupoView = GrupoDoc & {
  integrantes?: Array<{ nome: string; telefone1?: string|null; valorIndividual?: number|null }>;
  parcelas?: ParcelaDoc[];
};

@Component({
  standalone: true,
  selector: 'app-central-cobranca',
  imports: [CommonModule, FormsModule],
  templateUrl: './central-cobranca.component.html',
})
export class CentralCobrancaComponent implements OnInit {

  // Dados base
  grupos = signal<GrupoView[]>([]);

  // Estado UI
  expanded = signal<Record<string, boolean>>({});
  saving = signal(false);
  msg = signal<string | null>(null);

  // Filtros
  filtroCidade = signal<string>('');
  dataIni = signal<string>(''); // yyyy-mm-dd
  dataFim = signal<string>(''); // yyyy-mm-dd
  textoBusca = signal<string>('');

  // Modal: criar grupo
  showCreateModal = signal(false);
  // form do modal
  numeroContrato = '';
  nomeGrupo = '';
  operador = '';
  dataLiberacaoInput: string | Date | null = null;
  cidade = '';
  uf = '';

  // Modal: pagamento
  showPayModal = signal(false);
  payContratoId = signal<string | null>(null);
  payParcelaId = signal<string | null>(null);
  payParcelaLabel = signal<string>('');

  constructor(private data: CobrancaDataService) {}

  async ngOnInit() {
    await this.reload();
  }

  private z(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  private alerta(venc: Date, pago: boolean): 'D15'|'D7'|'D0'|'ATRASO'|'OK' {
    if (pago) return 'OK';
    const hoje = this.z(new Date());
    const d0 = this.z(venc);
    const diff = Math.ceil((+d0 - +hoje) / 86400000);
    if (diff === 15) return 'D15';
    if (diff === 7)  return 'D7';
    if (diff === 0)  return 'D0';
    if (diff < 0)    return 'ATRASO';
    return 'OK';
  }

  async reload() {
  this.saving.set(true);
  try {
    const grupos = await this.data.listContratos();

    // carrega subcoleções em paralelo (rápido e consistente)
    const view = await Promise.all(
      grupos.map(async (g) => {
        const [integrantes, parcelas] = await Promise.all([
          this.data.listIntegrantes(g.id),
          this.data.listParcelas(g.id),
        ]);
        return {
          ...g,
          integrantes: integrantes.map(i => ({
            nome: i.nome,
            telefone1: i.telefone1 ?? null,
            valorIndividual: i.valorIndividual ?? null,
          })),
          parcelas,
        };
      })
    );

    this.grupos.set(view);
  } finally {
    this.saving.set(false);
  }
}


  // KPIs por grupo
  kpiGrupo(g: GrupoView) {
    const arr = g.parcelas ?? [];
    const r = { d15: 0, d7: 0, d0: 0, atraso: 0, total: arr.length, emAberto: 0 };
    for (const p of arr) {
      const venc = (p.vencimento instanceof Timestamp) ? p.vencimento.toDate() : new Date();
      const a = this.alerta(venc, p.pago);
      if (!p.pago) r.emAberto++;
      if (a === 'D15') r.d15++;
      else if (a === 'D7') r.d7++;
      else if (a === 'D0') r.d0++;
      else if (a === 'ATRASO') r.atraso++;
    }
    return r;
  }

  toggle(gid: string) {
    const curr = { ...this.expanded() };
    curr[gid] = !curr[gid];
    this.expanded.set(curr);
  }

  // Filtro aplicado
  // Filtro robusto (não esconde tudo por engano)
gruposFiltrados = computed(() => {
  const lista = this.grupos();
  if (!lista || lista.length === 0) return [];

  const city = (this.filtroCidade() || '').trim().toLowerCase();
  const txt  = (this.textoBusca() || '').trim().toLowerCase();
  const di   = this.dataIni() ? new Date(this.dataIni() + 'T00:00:00') : null;
  const df   = this.dataFim() ? new Date(this.dataFim() + 'T23:59:59') : null;

  return lista.filter(g => {
    // cidade (contains em vez de igualdade estrita)
    if (city) {
      const gc = (g.cidade || '').toLowerCase();
      if (!gc.includes(city)) return false;
    }

    // texto livre (contrato, nome, operador, cidade, uf, integrantes)
    if (txt) {
      const hay =
        [
          g.id, g.numeroContrato, g.nomeGrupo ?? '', g.operador ?? '',
          g.cidade ?? '', g.uf ?? '',
          ...(g.integrantes ?? []).map(i => i.nome || '')
        ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(txt)) return false;
    }

    // intervalo de vencimentos (se informado)
    if (di || df) {
      const has = (g.parcelas ?? []).some(p => {
        const dv = p.vencimento ? p.vencimento.toDate() : null;
        if (!dv) return false;
        return (!di || dv >= di) && (!df || dv <= df);
      });
      if (!has) return false;
    }

    return true;
  });
});


  // Modal criar grupo
  openCreateModal() { this.showCreateModal.set(true); }
  closeCreateModal() { this.showCreateModal.set(false); }

  async salvarGrupo() {
    if (!this.numeroContrato.trim()) {
      this.msg.set('Informe o número do contrato.');
      return;
    }
    this.saving.set(true);
    try {
      const id = await this.data.upsertContrato({
        numeroContrato: this.numeroContrato.trim(),
        nomeGrupo: this.nomeGrupo || null,
        operador: this.operador || null,
        cidade: this.cidade || null,
        uf: this.uf || null,
        dataLiberacao: null,
      });
      if (this.dataLiberacaoInput) {
        await this.data.setDataLiberacao(id, this.dataLiberacaoInput);
      }
      // reset form
      this.numeroContrato = '';
      this.nomeGrupo = '';
      this.operador = '';
      this.dataLiberacaoInput = null;
      this.cidade = '';
      this.uf = '';
      this.showCreateModal.set(false);
      await this.reload();
      this.msg.set('Grupo criado com sucesso.');
    } catch (e) {
      console.error(e);
      this.msg.set('Falha ao criar grupo.');
    } finally {
      this.saving.set(false);
    }
  }

  // Modal pagamento
  openPayModal(contratoId: string, parcelaId: string, label: string) {
    this.payContratoId.set(contratoId);
    this.payParcelaId.set(parcelaId);
    this.payParcelaLabel.set(label);
    this.showPayModal.set(true);
  }
  closePayModal() { this.showPayModal.set(false); }

  async confirmarPagamento() {
    const cid = this.payContratoId();
    const pid = this.payParcelaId();
    if (!cid || !pid) return;
    this.saving.set(true);
    try {
      await this.data.setPago(cid, pid, true);
      this.showPayModal.set(false);
      await this.reload();
      this.msg.set('Parcela marcada como paga.');
    } catch (e) {
      console.error(e);
      this.msg.set('Falha ao marcar pagamento.');
    } finally {
      this.saving.set(false);
    }
  }
}
