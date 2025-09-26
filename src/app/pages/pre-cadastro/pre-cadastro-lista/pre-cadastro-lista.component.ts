import { Component, inject, signal, computed, effect, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { PreCadastro, FluxoCaixa } from '../../../models/pre-cadastro.model';
import { HeaderComponent } from '../../shared/header/header.component';
import { AgendamentoService } from '../../../services/agendamento.service';
import { Timestamp } from '@angular/fire/firestore';

type PreCadastroEdit = PreCadastro & { id: string };

@Component({
  selector: 'app-pre-cadastro-lista',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, FormsModule, HeaderComponent],
  templateUrl: './pre-cadastro-lista.component.html',
  styleUrls: ['./pre-cadastro-lista.component.css']
})
export class PreCadastroListaComponent implements OnInit, OnDestroy {
  private service = inject(PreCadastroService);
  private agService = inject(AgendamentoService);
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loading = signal(true);
  itens = signal<PreCadastro[]>([]);
  private sub?: Subscription;

  // ====== UI STATE ======
  searchTerm = signal<string>('');

  // filtros
  filtroStatus = signal<'todos' | 'nao_agendado' | 'agendado' | 'visitado'>('todos');
  filtroHasPhone = signal<'todos' | 'sim' | 'nao'>('todos');
  filtroHasEmail = signal<'todos' | 'sim' | 'nao'>('todos');
  filtroBairro = signal<string>('');
  filtroDataIni = signal<string>(''); // yyyy-MM-dd
  filtroDataFim = signal<string>(''); // yyyy-MM-dd

  // paginação
  pageSize = signal<number>(9);
  page = signal<number>(1);

  // modais
  modalVerAberto = signal(false);
  modalEditarAberto = signal(false);
  modalAgendarAberto = signal(false);

  viewItem = signal<PreCadastro | null>(null);
  editModel = signal<PreCadastroEdit | null>(null);
  itemAgendar = signal<PreCadastro | null>(null);

  saving = signal(false);
  agSalvando = signal(false);

  agData: string = ''; // yyyy-MM-dd
  agHora: string = ''; // HH:mm

  toastVisivel = signal(false);
  highlightId = signal<string | null>(null);

  currentUserUid: string | null = null;
  currentUserNome: string | null = null;

  constructor() {
    // sempre que busca/filtros mudarem, voltar para a primeira página
    effect(() => {
      this.searchTerm();
      this.filtroStatus();
      this.filtroHasPhone();
      this.filtroHasEmail();
      this.filtroBairro();
      this.filtroDataIni();
      this.filtroDataFim();
      this.page.set(1);
    });
  }

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(pm => {
      const hId = pm.get('highlightId');
      const flash = pm.get('highlightFlash');
      if (hId) this.highlightId.set(hId);
      if (flash) {
        this.toastVisivel.set(true);
        setTimeout(() => this.toastVisivel.set(false), 3000);
      }
    });

    this.sub = user(this.auth).subscribe(async u => {
      this.loading.set(true);
      try {
        if (!u) { this.itens.set([]); return; }
        this.currentUserUid = u.uid;
        this.currentUserNome = u.displayName || u.email || null;

        const rows = await this.service.listarDoAssessor(u.uid);
        const norm = rows.map(r => ({
          agendamentoStatus: (r as any).agendamentoStatus || 'nao_agendado',
          ...r
        } as PreCadastro));
        this.itens.set(norm);
      } catch (err) {
        console.error('[PreCadastro] Erro ao listar:', err);
        this.itens.set([]);
      } finally {
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // ===== Helpers =====
  private onlyDigits(v?: string | null): string { return (v ?? '').replace(/\D+/g, ''); }

  private toJSDate(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      try { return v.toDate(); } catch { return null; }
    }
    return null;
  }

  private normalize(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  whatsHref(v?: string | null): string {
    const d = this.onlyDigits(v);
    if (!d) return '';
    const core = d.startsWith('55') ? d : `55${d}`;
    return `https://wa.me/${core}`;
  }

  // ===== Derived UI data =====
  bairrosDisponiveis = computed<string[]>(() => {
    const set = new Set<string>();
    for (const x of this.itens()) {
      const b = (x.bairro ?? '').trim();
      if (b) set.add(b);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  // Filtra por busca + filtros
  filteredItems = computed<PreCadastro[]>(() => {
    const term = this.normalize(this.searchTerm());
    const st = this.filtroStatus();
    const hasPhone = this.filtroHasPhone();
    const hasEmail = this.filtroHasEmail();
    const bairro = this.filtroBairro();
    const dataIni = this.filtroDataIni();
    const dataFim = this.filtroDataFim();

    const dtIni = dataIni ? new Date(dataIni + 'T00:00:00') : null;
    const dtFim = dataFim ? new Date(dataFim + 'T23:59:59') : null;

    return this.itens().filter(i => {
      if (term) {
        const nome = this.normalize(i.nomeCompleto ?? (i as any).nome ?? '');
        if (!nome.includes(term)) return false;
      }

      const statusAtual = (i.agendamentoStatus || 'nao_agendado') as 'nao_agendado' | 'agendado' | 'visitado';
      if (st !== 'todos' && statusAtual !== st) return false;

      const temTel = !!(i.telefone && this.onlyDigits(i.telefone).length >= 10);
      if (hasPhone === 'sim' && !temTel) return false;
      if (hasPhone === 'nao' && temTel) return false;

      const temEmail = !!((i.email ?? '').trim());
      if (hasEmail === 'sim' && !temEmail) return false;
      if (hasEmail === 'nao' && temEmail) return false;

      if (bairro && (i.bairro ?? '') !== bairro) return false;

      if (dtIni || dtFim) {
        const created = this.toJSDate(i.createdAt);
        if (!created) return false;
        if (dtIni && created < dtIni) return false;
        if (dtFim && created > dtFim) return false;
      }

      return true;
    });
  });

  totalFiltrado = computed<number>(() => this.filteredItems().length);
  totalGeral = computed<number>(() => this.itens().length);

  totalPages = computed<number>(() => {
    const n = Math.ceil(this.totalFiltrado() / this.pageSize());
    return Math.max(1, n || 1);
  });

  pagedItems = computed<PreCadastro[]>(() => {
    const p = this.page();
    const ps = this.pageSize();
    const arr = this.filteredItems();
    const start = (p - 1) * ps;
    return arr.slice(start, start + ps);
  });

  // paginação actions
  setPageSize(n: number) {
    this.pageSize.set(n);
    this.page.set(1);
  }
  goFirst() { this.page.set(1); }
  goPrev() { this.page.update(p => Math.max(1, p - 1)); }
  goNext() { this.page.update(p => Math.min(this.totalPages(), p + 1)); }
  goLast() { this.page.set(this.totalPages()); }
  goTo(n: number) { this.page.set(Math.min(Math.max(1, n), this.totalPages())); }

  // ===== Abertura/fechamento modais =====
  abrirVer(i: PreCadastro) { this.viewItem.set(i); this.modalVerAberto.set(true); }

  private defaultFluxo(): FluxoCaixa {
    return {
      faturamentoMensal: 0,
      fixos: {
        aluguel: 0,
        salarios: 0,
        energiaEletrica: 0,
        agua: 0,
        telefoneInternet: 0
      },
      variaveis: {
        materiaPrima: 0,
        insumos: 0,
        frete: 0,
        transporte: 0,
        outros: []
      }
    };
  }

  abrirEditar(i: PreCadastro) {
    if (!i?.id) { console.warn('Item sem ID'); return; }
    // Clona e garante fluxoCaixa não-nulo para edição
    const fluxo = i.fluxoCaixa ? JSON.parse(JSON.stringify(i.fluxoCaixa)) as FluxoCaixa : this.defaultFluxo();
    this.editModel.set({
      ...(i as any),
      id: i.id,
      // normaliza strings principais
      cpf: (i.cpf ?? '').trim(),
      telefone: (i.telefone ?? '').trim(),
      email: (i.email ?? '').trim(),
      nomeCompleto: (i.nomeCompleto ?? '').trim(),
      bairro: i.bairro ?? '',
      endereco: i.endereco ?? '',
      fluxoCaixa: fluxo
    });
    this.modalEditarAberto.set(true);
  }

  fecharModais() {
    this.modalVerAberto.set(false);
    this.modalEditarAberto.set(false);
    this.modalAgendarAberto.set(false);
    this.viewItem.set(null);
    this.editModel.set(null);
    this.itemAgendar.set(null);
    this.agData = '';
    this.agHora = '';
  }

  // ===== Atualização do editModel (top-level, sem arrow/spread no template) =====
  onEditChange<K extends keyof PreCadastroEdit>(prop: K, value: PreCadastroEdit[K]) {
    const m = this.editModel();
    if (!m) return;

    // números top-level que você pode editar aqui
    const numericProps = new Set(['valorSolicitado', 'parcelas', 'valorParcela']);

    let v: any = value;
    if (numericProps.has(prop as string) && typeof value === 'string') {
      v = value === '' ? undefined : Number(value);
    }

    this.editModel.set({ ...(m as any), [prop]: v });
  }

  // ===== Atualização do fluxoCaixa (aninhado) =====
  onFluxoNumberChange(path: string, value: string | number) {
    // path exemplos:
    // 'faturamentoMensal'
    // 'fixos.aluguel'
    // 'variaveis.materiaPrima'
    // 'variaveis.outros[3].valor'  (aqui cuidaremos via helpers específicos, ver mais abaixo)
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();

    // converte para número
    const num = typeof value === 'string' ? (value === '' ? 0 : Number(value)) : value;

    const setNested = (obj: any, p: string[], val: any) => {
      if (p.length === 1) { obj[p[0]] = val; return; }
      const [head, ...rest] = p;
      if (!(head in obj) || typeof obj[head] !== 'object' || obj[head] === null) obj[head] = {};
      setNested(obj[head], rest, val);
    };

    setNested(fluxo as any, path.split('.'), num);

    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  // ===== Outros (lista dinâmica) =====
  addOutro() {
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const arr = fluxo.variaveis?.outros ?? [];
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima:0, insumos:0, frete:0, transporte:0, outros:[] }) };
    fluxo.variaveis.outros = [...arr, { nome: '', valor: 0 }];
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  removeOutro(index: number) {
    const m = this.editModel();
    if (!m || !m.fluxoCaixa?.variaveis?.outros) return;
    const fluxo = { ...m.fluxoCaixa };
    fluxo.variaveis = { ...fluxo.variaveis, outros: fluxo.variaveis.outros.filter((_, i) => i !== index) };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  onOutroNomeChange(index: number, value: string) {
    const m = this.editModel();
    if (!m) return;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const outros = [...(fluxo.variaveis?.outros ?? [])];
    if (!outros[index]) outros[index] = { nome: '', valor: 0 };
    outros[index] = { ...outros[index], nome: value };
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima:0, insumos:0, frete:0, transporte:0, outros:[] }), outros };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  onOutroValorChange(index: number, value: string | number) {
    const m = this.editModel();
    if (!m) return;
    const num = typeof value === 'string' ? (value === '' ? 0 : Number(value)) : value;
    const fluxo = m.fluxoCaixa ? { ...m.fluxoCaixa } : this.defaultFluxo();
    const outros = [...(fluxo.variaveis?.outros ?? [])];
    if (!outros[index]) outros[index] = { nome: '', valor: 0 };
    outros[index] = { ...outros[index], valor: Number(num) };
    fluxo.variaveis = { ...(fluxo.variaveis || { materiaPrima:0, insumos:0, frete:0, transporte:0, outros:[] }), outros };
    this.editModel.set({ ...(m as any), fluxoCaixa: fluxo });
  }

  // ===== CRUD =====
  async salvarEdicao() {
    const m = this.editModel();
    if (!m?.id) return;

    this.saving.set(true);
    try {
      // Monta patch aderente ao SEU modelo
      const patch: Partial<PreCadastro> = {
        nomeCompleto: (m.nomeCompleto ?? '').trim(),
        cpf: (m.cpf ?? '').trim(),
        telefone: (m.telefone ?? '').trim(),
        email: (m.email ?? '').trim(),
        bairro: (m.bairro ?? '').trim(),
        endereco: (m.endereco ?? '').trim(),
        origem: m.origem ?? '',

        // Financeiro
        valorSolicitado: typeof m.valorSolicitado === 'number' ? m.valorSolicitado : m.valorSolicitado ? Number(m.valorSolicitado) : undefined,
        parcelas: m.parcelas ?? null,
        valorParcela: typeof m.valorParcela === 'number' ? m.valorParcela : m.valorParcela ? Number(m.valorParcela) : undefined,
        fluxoCaixa: m.fluxoCaixa ? { ...m.fluxoCaixa } : undefined,
        fluxoCaixaTotais: m.fluxoCaixaTotais ?? undefined,
      };

      await this.service.atualizar(m.id, patch);
      this.itens.update(list => list.map(x => (x.id === m.id ? { ...x, ...patch } as PreCadastro : x)));
      this.fecharModais();
      alert('Pré-cadastro editado com sucesso!');
    } catch (err) {
      console.error('[PreCadastro] Erro ao salvar edição:', err);
      alert('Falha ao salvar. Tente novamente.');
    } finally {
      this.saving.set(false);
    }
  }

  async remover(item: PreCadastro) {
    if (!item?.id) { console.warn('Sem ID:', item); return; }
    const ok = confirm(`Remover o pré-cadastro de "${item.nomeCompleto ?? 'sem nome'}"?`);
    if (!ok) return;

    try {
      const agId = (item as any)?.agendamentoId;
      if (agId) { try { await this.agService.remover(agId); } catch {} }

      await this.service.remover(item.id);
      this.itens.update(lista => lista.filter(x => x.id !== item.id));
    } catch (err) {
      console.error('[PreCadastro] Erro ao remover:', err);
      alert('Falha ao remover. Tente novamente.');
    }
  }

  private buildQueryFromPre(pc: PreCadastro): Record<string, any> {
    const contato = this.onlyDigits((pc as any)?.telefone ?? (pc as any)?.contato ?? '');
    const cpf = this.onlyDigits((pc as any)?.cpf ?? '');
    return {
      nome: (pc as any)?.nomeCompleto ?? (pc as any)?.nome ?? '',
      cpf,
      contato,
      email: (pc as any)?.email ?? '',
      endereco: (pc as any)?.endereco ?? (pc as any)?.enderecoCompleto ?? '',
      preCadastroId: (pc as any)?.id ?? (pc as any)?.uid ?? '',
    };
  }

  iniciarCadastro(pc: PreCadastro) {
    this.fecharModais();
    const qp = this.buildQueryFromPre(pc);
    this.router.navigate(['/cadastro', 'novo'], { queryParams: qp });
  }

  // ====== AGENDAMENTO ======
  abrirAgendar(i: PreCadastro) {
    this.itemAgendar.set(i);
    this.agData = '';
    this.agHora = '';
    this.modalAgendarAberto.set(true);
  }

  private combineToTimestamp(dateStr: string, timeStr: string): Timestamp {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const js = new Date(y, (m - 1), d, hh, mm, 0);
    return Timestamp.fromDate(js);
  }

  async salvarAgendamento() {
    const pre = this.itemAgendar();
    const data = (this.agData || '').trim();
    const hora = (this.agHora || '').trim();

    if (!pre?.id) { alert('Pré-cadastro inválido.'); return; }
    if (!this.currentUserUid) { alert('Usuário não autenticado.'); return; }
    if (!data || !hora) { alert('Informe data e horário.'); return; }

    this.agSalvando.set(true);
    try {
      const dataHora = this.combineToTimestamp(data, hora);
      const agId = await this.agService.criar({
        preCadastroId: pre.id,
        clienteNome: pre.nomeCompleto ?? null,
        clienteCpf: pre.cpf ?? null,
        clienteTelefone: pre.telefone ?? null,
        clienteEmail: pre.email ?? null,
        clienteEndereco: pre.endereco ?? null,
        clienteBairro: pre.bairro ?? null,
        dataHora,
        assessorUid: this.currentUserUid!,
        assessorNome: this.currentUserNome ?? null,
        createdByUid: this.currentUserUid!,
        status: 'agendado'
      });

      await this.service.atualizar(pre.id, {
        agendamentoStatus: 'agendado',
        agendamentoId: agId,
      } as any);

      this.itens.update(list => list.map(x => (x.id === pre.id ? { ...x, agendamentoStatus: 'agendado', agendamentoId: agId } : x)));

      this.modalAgendarAberto.set(false);
      this.itemAgendar.set(null);
      alert('Agendamento criado com sucesso!');
    } catch (e) {
      console.error('[Agendamento] erro ao salvar:', e);
      alert('Não foi possível criar o agendamento.');
    } finally {
      this.agSalvando.set(false);
    }
  }

  async marcarVisitado(i: PreCadastro) {
    if (!i?.id) return;
    try {
      await this.service.atualizar(i.id, { agendamentoStatus: 'visitado' } as any);
      this.itens.update(list => list.map(x => (x.id === i.id ? { ...x, agendamentoStatus: 'visitado' } : x)));

      const agId = (i as any)?.agendamentoId;
      if (agId) {
        try { await this.agService.atualizar(agId, { status: 'visitado' } as any); }
        catch (e: any) {
          if (e?.code === 'not-found' || /No document to update/i.test(e?.message || '')) {
            console.warn('[Pré] agendamento não existe mais, ignorando sync.');
          } else {
            throw e;
          }
        }
      }
    } catch (e) {
      console.error('[Agendamento] erro ao marcar visitado:', e);
      alert('Falha ao marcar como visitado.');
    }
  }

  async cancelarAgendamento(i: PreCadastro) {
    const agId = (i as any)?.agendamentoId;
    if (!i?.id || !agId) { alert('Não há agendamento para cancelar.'); return; }
    const ok = confirm(`Cancelar o agendamento de "${i.nomeCompleto || 'cliente'}"?`);
    if (!ok) return;

    try {
      try { await this.agService.remover(agId); }
      catch (e: any) {
        if (e?.code === 'not-found' || /No document to delete|NOT_FOUND/i.test(e?.message || '')) {
          console.warn('[Pré] agendamento já removido, seguindo.');
        } else {
          throw e;
        }
      }

      await this.service.atualizar(i.id, {
        agendamentoStatus: 'nao_agendado',
        agendamentoId: null as any
      } as any);

      this.itens.update(list => list.map(x => (x.id === i.id ? { ...x, agendamentoStatus: 'nao_agendado', agendamentoId: null } : x)));
      alert('Agendamento cancelado.');
    } catch (e) {
      console.error('[Agendamento] erro ao cancelar:', e);
      alert('Não foi possível cancelar o agendamento.');
    }
  }
}
