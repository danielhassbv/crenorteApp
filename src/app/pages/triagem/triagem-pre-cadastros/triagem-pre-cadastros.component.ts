// src/app/pages/triagem/triagem-pre-cadastros/triagem-pre-cadastros.component.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Firestore
import { db } from '../../../firebase.config';
import {
  collectionGroup,
  onSnapshot,
  query,
  Unsubscribe,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  where,
  writeBatch,
  orderBy,
  startAfter,
  limit as qLimit,
} from 'firebase/firestore';

/* =========================
   Normalização & Origens
   ========================= */
function normalizeBasic(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleCase(s: string): string {
  return (s || '').toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase());
}

// Sinônimos -> chave canônica
const ORIGEM_SYNONYMS: Record<string, string> = {
  'panfleto': 'panfleto', 'panfletos': 'panfleto',
  'online': 'online', 'on-line': 'online', 'site': 'online',
  'formulario': 'online', 'formulário': 'online',
  'telefone': 'telefone', 'tel': 'telefone', 'celular': 'telefone', 'cel': 'telefone',
  'whatsapp': 'whatsapp', 'wpp': 'whatsapp', 'zap': 'whatsapp', 'wtz': 'whatsapp', 'whats': 'whatsapp',
  'igreja': 'igreja',
  'presencial': 'presencial', 'visita': 'presencial', 'visita presencial': 'presencial', 'cadastro presencial': 'presencial',
  'indicacao': 'indicacao', 'indicação': 'indicacao',
  'proprio': 'proprio', 'próprio': 'proprio', 'própria': 'proprio'
};

const ORIGEM_LABELS: Record<string, string> = {
  panfleto: 'Panfleto',
  online: 'Online',
  telefone: 'Telefone',
  whatsapp: 'WhatsApp',
  igreja: 'Igreja',
  presencial: 'Presencial',
  indicacao: 'Indicação',
  proprio: 'Próprio',
  outros: 'Outros',
};

// status exibido no UI (chip)
type StatusAprovacao = 'nao' | 'apto' | 'inapto';
function coerceStatusToUi(x: any): StatusAprovacao {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao';
}

// status no Firestore (novo nó aprovacao.status)
type AprovacaoStatus = 'nao_verificado' | 'apto' | 'inapto';
function mapLegacyToNovo(x: any): AprovacaoStatus {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao_verificado';
}

function canonicalizeOrigem(raw: string): { key: string; label: string } {
  const n = normalizeBasic(raw);

  if (n in ORIGEM_SYNONYMS) {
    const key = ORIGEM_SYNONYMS[n];
    return { key, label: ORIGEM_LABELS[key as keyof typeof ORIGEM_LABELS] || titleCase(key) };
  }
  if (/whats|zap|wpp/.test(n)) return { key: 'whatsapp', label: ORIGEM_LABELS['whatsapp'] };
  if (/on\s?-?\s?line|site|formul/.test(n)) return { key: 'online', label: ORIGEM_LABELS['online'] };
  if (/telefone|tel|cel/.test(n)) return { key: 'telefone', label: ORIGEM_LABELS['telefone'] };
  if (/igreja/.test(n)) return { key: 'igreja', label: ORIGEM_LABELS['igreja'] };
  if (/presencial|visita/.test(n)) return { key: 'presencial', label: ORIGEM_LABELS['presencial'] };
  if (/indic/.test(n)) return { key: 'indicacao', label: ORIGEM_LABELS['indicacao'] };
  if (/propri/.test(n)) return { key: 'proprio', label: ORIGEM_LABELS['proprio'] };

  if (n) return { key: n, label: titleCase(raw) };
  return { key: 'outros', label: ORIGEM_LABELS['outros'] };
}

/* =========================
   Tipos
   ========================= */
type PreCadastroRow = {
  id: string;
  data: Date | null;

  nome: string;
  cpf: string;
  telefone: string;
  email: string;
  endereco: string;
  bairro: string;
  rota: string;
  cidade?: string;
  uf?: string;

  origem: string;
  origemKey: string;
  origemLabel: string;

  statusAprovacao?: 'nao' | 'apto' | 'inapto';

  // === Distribuição ===
  designadoEm?: Date | null;
  designadoParaUid?: string | null;
  designadoParaNome?: string | null;

  _path: string;
  _eDeAssessor?: boolean;

  createdByUid?: string | null;
  createdByNome?: string | null;
};

type Assessor = {
  uid: string;
  nome?: string;
  email?: string;
  status?: string;
  papel?: string;
  rota?: string;
};

type PeriodoKey = 'todos' | 'hoje' | '7' | '30';
type StatusKey = 'todos' | 'nao' | 'apto' | 'inapto';
type DistRow = { key: string; dt: Date | null; label: string; aptos: number; inaptos: number; nao: number; total: number; };
type DistGroup = { key: string; label: string; dt: Date | null; itens: PreCadastroRow[] };

// 🔹 NOVO: chaves válidas dos grupos de filtros (inclui criador/destino)
type FilterGroupKey = 'status' | 'periodo' | 'origem' | 'bairros' | 'criador' | 'destino';

/* =========================
   Componente
   ========================= */
@Component({
  standalone: true,
  selector: 'app-triagem-pre-cadastros',
  imports: [CommonModule, FormsModule],
  templateUrl: './triagem-pre-cadastros.component.html',
  styleUrls: ['./triagem-pre-cadastros.component.css'],
})
export class TriagemPreCadastrosComponent implements OnInit, OnDestroy {
  carregando = signal(false);
  erro = signal<string | null>(null);

  // UI
  density: 'relax' | 'compact' = 'relax';
  setDensity(mode: 'relax' | 'compact') { this.density = mode; }

  // Drawer lateral (mobile)
  showFilters = false;
  toggleFilters() { this.showFilters ? this.closeFilters() : this.openFilters(); }
  openFilters() { this.showFilters = true; try { document.body.classList.add('no-scroll'); } catch { } }
  closeFilters() { this.showFilters = false; try { document.body.classList.remove('no-scroll'); } catch { } }

  // Estado de colapso por grupo (agora com criador/destino)
  filterOpen: Record<FilterGroupKey, boolean> = {
    status: true, periodo: false, origem: true, bairros: false, criador: false, destino: false
  };
  toggleGroup(k: FilterGroupKey) {
    this.filterOpen[k] = !this.filterOpen[k];
    this.persistFilterUI();
  }
  isOpen(k: FilterGroupKey) { return this.filterOpen[k]; }
  private persistFilterUI() {
    try { localStorage.setItem('triagemFilterOpen', JSON.stringify(this.filterOpen)); } catch { }
  }
  private loadFilterUI() {
    try {
      const raw = localStorage.getItem('triagemFilterOpen');
      if (raw) this.filterOpen = { ...this.filterOpen, ...(JSON.parse(raw) as Partial<Record<FilterGroupKey, boolean>>) };
    } catch { }
  }

  // filtros
  busca = '';
  filtroRota = '';
  somenteNaoDesignados = false; // mantido para compat, não usado no novo status

  // filtros agregados
  origens: Array<{ key: string; label: string; count: number }> = [];
  filtroOrigemKey = '';

  // Filtros por assessor (criador e distribuído)
  filtroCriadorUid: string = '';
  filtroDistribuidoUid: string = '';

  topBairros: Array<{ label: string; count: number }> = [];
  filtroBairro = '';

  statusFilter: StatusKey = 'todos';
  periodoFilter: PeriodoKey = 'todos';

  // dados
  private unsub?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];

  // paginação
  pageSize = 20;
  currentPage = 1;
  get totalItems() { return this.view.length; }
  get totalPages() { return Math.max(1, Math.ceil(this.totalItems / this.pageSize)); }
  get pageStart() { return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0; }
  get pageEnd() { return Math.min(this.pageStart + this.pageSize, this.totalItems); }
  get pageItems() { return this.view.slice(this.pageStart, this.pageEnd); }

  // assessores / designação
  assessores: Assessor[] = [];
  selecaoAssessor: Record<string, string> = {};       // rowId -> uid
  selecaoAssessorNome: Record<string, string> = {};   // rowId -> nome exibido
  designando: Record<string, boolean> = {};
  errDesignado: Record<string, boolean> = {};

  // modal
  showAssessorModal = false;
  assessorBusca = '';
  assessoresFiltrados: Assessor[] = [];
  rowSelecionado: PreCadastroRow | null = null;
  selectedAssessorUid: string | null = null;

  // Migração em massa
  migrandoAprovacao = false;
  migracaoTotal = 0;
  migracaoProcessados = 0;

  async ngOnInit(): Promise<void> {
    this.loadFilterUI();
    await this.carregarAssessores();   // TODOS os assessores/analistas/admin
    this.carregarTodos();
  }
  ngOnDestroy(): void { this.unsub?.(); }

  /* ============ Carregar dados ============ */
  private carregarTodos() {
    this.carregando.set(true);
    this.erro.set(null);

    const base = collectionGroup(db, 'pre_cadastros');
    const qy = query(base);

    this.unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: PreCadastroRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          const path = d.ref.path;

          const origemRaw = String(data?.origem ?? '').trim();
          const canon = canonicalizeOrigem(origemRaw);

          // Preferir aprovacao.status (novo) e cair para o legado statusAprovacao
          let uiStatus: StatusAprovacao = 'nao';
          if (data?.aprovacao?.status) {
            const novo = String(data.aprovacao.status);
            uiStatus = (normalizeBasic(novo) === 'apto') ? 'apto'
              : (normalizeBasic(novo) === 'inapto') ? 'inapto'
                : 'nao';
          } else {
            uiStatus = coerceStatusToUi(data?.statusAprovacao);
          }

          return {
            id: d.id,
            data: this.toDate(data?.createdAt ?? data?.criadoEm),

            nome: String(data?.nomeCompleto ?? data?.nome ?? '').trim(),
            cpf: String(data?.cpf ?? '').trim(),
            telefone: String(data?.telefone ?? data?.contato ?? '').trim(),
            email: String(data?.email ?? '').trim(),
            endereco: String(data?.endereco ?? data?.enderecoCompleto ?? '').trim(),
            bairro: String(data?.bairro ?? '').trim(),
            rota: String(data?.rota ?? '').trim(),
            cidade: String(data?.cidade ?? '').trim(),        // ✅ novo
            uf: String(data?.uf ?? data?.estado ?? '').trim(), // ✅ novo

            origem: origemRaw,
            origemKey: canon.key,
            origemLabel: canon.label,

            statusAprovacao: uiStatus,

            // === campos de distribuição ===
            designadoEm: this.toDate(data?.designadoEm) ?? null,
            designadoParaUid: (data?.designadoPara ?? data?.createdByUid) ?? null,
            designadoParaNome: (data?.createdByNome ?? null),

            _path: path,
            _eDeAssessor: path.startsWith('colaboradores/'),
            createdByUid: data?.createdByUid ?? null,
            createdByNome: data?.createdByNome ?? null,
          };

        });

        rows.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

        rows.forEach((r) => {
          if (r.createdByUid) {
            this.selecaoAssessor[r.id] = r.createdByUid!;
            this.selecaoAssessorNome[r.id] = r.createdByNome || this.resolveAssessorNome(r.createdByUid!);
          }
        });

        this.all = rows;
        this.atualizarOrigens();
        this.atualizarBairros();
        this.aplicarFiltros();
        this.carregando.set(false);
      },
      (err) => {
        console.error('[Triagem] onSnapshot error:', err);
        this.erro.set(err?.message ?? 'Falha ao carregar pré-cadastros.');
        this.carregando.set(false);
      }
    );
  }

  /**
   * Carrega TODOS os usuários ativos com papel assessor/analista/admin.
   */
  private async carregarAssessores() {
    try {
      const col = collection(db, 'colaboradores');
      const q1 = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', 'in', ['assessor', 'admin', 'analista'])
      );
      const snap = await getDocs(q1);

      this.assessores = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            uid: d.id,
            nome: x?.nome ?? x?.displayName ?? '',
            email: x?.email ?? '',
            status: x?.status,
            papel: x?.papel,
            rota: x?.rota ?? '',
          } as Assessor;
        })
        .sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? ''));
    } catch (e) {
      console.error('[Triagem] Falha ao carregar assessores:', e);
      this.assessores = [];
    }
  }

  /* ============ Utils ============ */
  private toDate(x: unknown): Date | null {
    if (!x) return null;
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }
  private normalize(s: string): string { return normalizeBasic(s); }
  initial(s: string): string {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }
  nomeAssessor(a: Assessor | undefined): string { return (a?.nome || a?.email || a?.uid || '').toString(); }
  resolveAssessorNome(uid: string): string {
    const a = this.assessores.find((x) => x.uid === uid);
    return this.nomeAssessor(a) || uid;
  }
  trackById = (_: number, r: PreCadastroRow) => r._path || r.id;

  isEnviado(r: PreCadastroRow): boolean { return !!(r.createdByUid && String(r.createdByUid).trim()); }
  actionLabel(r: PreCadastroRow): string { return this.isEnviado(r) ? 'Atualizar' : 'Enviar'; }
  isEnviarDisabled(r: PreCadastroRow): boolean {
    const sel = this.selecaoAssessor[r.id];
    if (!sel) return true;
    if (this.designando[r.id]) return true;
    if (this.isEnviado(r) && sel === r.createdByUid) return true;
    return false;
  }

  /* ============ Filtros & Quick Filters ============ */
  onBusca(val: string) { this.busca = (val ?? '').trim(); this.aplicarFiltros(); }
  onFiltroRota(val: string) { this.filtroRota = (val ?? '').trim(); this.aplicarFiltros(); }
  limparFiltros() {
    this.busca = '';
    this.filtroRota = '';
    this.filtroOrigemKey = '';
    this.filtroBairro = '';
    this.statusFilter = 'todos';
    this.periodoFilter = 'todos';
    this.somenteNaoDesignados = false;

    // NOVOS
    this.filtroCriadorUid = '';
    this.filtroDistribuidoUid = '';

    this.aplicarFiltros();
  }

  onFiltroCriadorChange(uid: string) {
    this.filtroCriadorUid = (uid || '').trim();
    this.aplicarFiltros();
  }
  limparFiltroCriador() {
    this.filtroCriadorUid = '';
    this.aplicarFiltros();
  }

  onFiltroDistribuidoChange(uid: string) {
    this.filtroDistribuidoUid = (uid || '').trim();
    this.aplicarFiltros();
  }
  limparFiltroDistribuido() {
    this.filtroDistribuidoUid = '';
    this.aplicarFiltros();
  }

  // --- Helpers de status (para o template) ---
  statusLabel(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto': return 'Apto';
      case 'inapto': return 'Inapto';
      default: return 'Não verificado';
    }
  }
  statusIcon(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto': return '✅';
      case 'inapto': return '⛔';
      default: return '🕑';
    }
  }
  statusChipClass(s?: StatusAprovacao | null) {
    return {
      'chip-status': true,
      'is-apto': s === 'apto',
      'is-inapto': s === 'inapto',
      'is-nao': !s || (s !== 'apto' && s !== 'inapto'),
    };
  }

  // status (filtro)
  setStatus(k: StatusKey) {
    this.statusFilter = (this.statusFilter === k ? 'todos' : k);
    this.aplicarFiltros();
  }
  isStatusActive(k: StatusKey) { return this.statusFilter === k; }

  // período
  setPeriodo(k: PeriodoKey) { this.periodoFilter = (this.periodoFilter === k ? 'todos' : k); this.aplicarFiltros(); }
  isPeriodoActive(k: PeriodoKey) { return this.periodoFilter === k; }

  // origem canônica
  setOrigem(key: string) { this.filtroOrigemKey = (this.filtroOrigemKey === key ? '' : key); this.aplicarFiltros(); }
  isOrigemActive(key: string) { return this.filtroOrigemKey === key; }

  // bairros
  setBairro(label: string) { this.filtroBairro = (this.filtroBairro === label ? '' : label); this.aplicarFiltros(); }
  isBairroActive(label: string) { return this.filtroBairro === label; }

  private atualizarOrigens() {
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const r of this.all) {
      const key = r.origemKey || 'outros';
      const label = r.origemLabel || ORIGEM_LABELS[key as keyof typeof ORIGEM_LABELS] || 'Outros';
      const slot = map.get(key) || { key, label, count: 0 };
      slot.count++;
      map.set(key, slot);
    }
    this.origens = Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  private atualizarBairros() {
    const map = new Map<string, number>();
    for (const r of this.all) {
      const b = (r.bairro || '').trim();
      if (!b) continue;
      const label = titleCase(b);
      map.set(label, (map.get(label) || 0) + 1);
    }
    this.topBairros = Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 12);
  }

  aplicarFiltros() {
    let list = [...this.all];

    const term = this.normalize(this.busca);
    const rota = this.normalize(this.filtroRota);
    const origemKey = this.filtroOrigemKey;
    const bairroSel = this.filtroBairro;

    if (rota) list = list.filter(p => this.normalize(p.rota).includes(rota));
    if (origemKey) list = list.filter(p => p.origemKey === origemKey);
    if (bairroSel) list = list.filter(p => titleCase(p.bairro || '') === bairroSel);

    // Filtrar por "Criado por (assessor)"
    if (this.filtroCriadorUid) {
      list = list.filter(p => (p.createdByUid || '') === this.filtroCriadorUid);
    }

    // Filtrar por "Distribuído para (assessor)"
    if (this.filtroDistribuidoUid) {
      // Considera apenas registros efetivamente distribuídos
      list = list.filter(p =>
        !!p.designadoEm &&
        !!p.designadoParaUid &&
        p.designadoParaUid === this.filtroDistribuidoUid
      );
    }

    // filtro por status (novo conceito)
    if (this.statusFilter !== 'todos') {
      list = list.filter(p => (p.statusAprovacao || 'nao') === this.statusFilter);
    }

    if (this.periodoFilter !== 'todos') {
      const now = new Date();
      const start = new Date(); start.setHours(0, 0, 0, 0);
      if (this.periodoFilter === 'hoje') {
        list = list.filter(p => p.data && p.data >= start);
      } else {
        const days = Number(this.periodoFilter);
        const min = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        list = list.filter(p => p.data && p.data >= min);
      }
    }

    if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.origemLabel}`
        );
        return blob.includes(term);
      });
    }

    this.view = list;
    this.currentPage = 1; // reset paginação
  }

  /* ===== Paginação ===== */
  onPageSizeChange(val: number) {
    const n = Number(val) || 10;
    this.pageSize = n;
    this.currentPage = 1;
  }
  nextPage() { if (this.currentPage < this.totalPages) this.currentPage++; }
  prevPage() { if (this.currentPage > 1) this.currentPage--; }

  /* ============ Enviar/Atualizar ============ */
  async designarParaAssessor(r: PreCadastroRow) {
    const uid = this.selecaoAssessor[r.id];
    if (!uid) return;

    this.designando[r.id] = true;
    this.errDesignado[r.id] = false;

    try {
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador não encontrado.');

      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      const srcRef = doc(db, r._path);
      const patch = {
        createdByUid: uid,
        createdByNome: assessorNome,
        designadoEm: serverTimestamp(),
        designadoPara: uid,
      };
      await setDoc(srcRef, patch, { merge: true });

      const idx = this.all.findIndex((x) => x.id === r.id && x._path === r._path);
      if (idx >= 0) {
        this.all[idx] = { ...this.all[idx], createdByUid: uid, createdByNome: assessorNome };
        this.selecaoAssessorNome[r.id] = assessorNome || this.resolveAssessorNome(uid);
        this.aplicarFiltros();
      }
    } catch (e) {
      console.error('[Triagem] designarParaAssessor erro:', e);
      this.errDesignado[r.id] = true;
      alert('Não foi possível enviar/atualizar. Tente novamente.');
    } finally {
      this.designando[r.id] = false;
    }
  }

  /* ============ Modal ============ */
  abrirModalAssessor(row: PreCadastroRow) {
    this.rowSelecionado = row;
    this.assessorBusca = '';
    this.filtrarAssessores();
    this.selectedAssessorUid = this.selecaoAssessor[row.id] || null; // pré-seleção
    this.showAssessorModal = true;
  }
  fecharModalAssessor() {
    this.showAssessorModal = false;
    this.rowSelecionado = null;
    this.selectedAssessorUid = null;
  }
  filtrarAssessores() {
    const t = this.normalize(this.assessorBusca);
    let arr = [...this.assessores];
    if (t) {
      arr = arr.filter((a) =>
        this.normalize(`${a.nome ?? ''} ${a.email ?? ''} ${a.rota ?? ''}`).includes(t)
      );
    }
    arr.sort((a, b) => (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? ''));
    this.assessoresFiltrados = arr;
  }
  escolherAssessor(a: Assessor) {
    if (!this.rowSelecionado) return;
    this.selecaoAssessor[this.rowSelecionado.id] = a.uid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.nomeAssessor(a);
    this.selectedAssessorUid = a.uid; // reflete no radio
  }
  async escolherEEnviar(a: Assessor) {
    if (!this.rowSelecionado) return;
    this.selecaoAssessor[this.rowSelecionado.id] = a.uid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.nomeAssessor(a);
    const row = this.rowSelecionado;
    this.fecharModalAssessor();
    await this.designarParaAssessor(row);
  }
  async enviarSelecionadoDoModal() {
    if (!this.rowSelecionado || !this.selectedAssessorUid) return;
    const aUid = this.selectedAssessorUid;
    this.selecaoAssessor[this.rowSelecionado.id] = aUid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.resolveAssessorNome(aUid) || aUid;
    const row = this.rowSelecionado;
    this.fecharModalAssessor();
    await this.designarParaAssessor(row);
  }

  /* ============ MIGRAÇÃO EM MASSA: aprovacao.status =========== */
  async migrarAprovacaoEmMassa() {
    const ok = confirm(
      'Isso vai verificar todos os pré-cadastros e gravar "aprovacao.status" quando estiver faltando.\n' +
      'Deseja continuar?'
    );
    if (!ok) return;

    this.migrandoAprovacao = true;
    this.migracaoTotal = 0;
    this.migracaoProcessados = 0;

    // helper para montar query paginada sem colocar undefined nos constraints
    const buildPageQuery = (afterDoc: any | null, size: number) => {
      const constraints: any[] = [orderBy('__name__')];
      if (afterDoc) constraints.push(startAfter(afterDoc));
      constraints.push(qLimit(size));
      return query(collectionGroup(db, 'pre_cadastros'), ...constraints);
    };

    try {
      const pageSize = 300;
      const batchMax = 450;
      let last: any = null;

      // --- estimativa para mostrar progresso ---
      {
        let _last: any = null, _total = 0;
        while (true) {
          const q = buildPageQuery(_last, pageSize);
          const s = await getDocs(q);
          _total += s.size;
          if (s.size < pageSize) break;
          _last = s.docs[s.docs.length - 1];
        }
        this.migracaoTotal = _total;
      }

      // --- migração efetiva ---
      while (true) {
        const q = buildPageQuery(last, pageSize);
        const snap = await getDocs(q);
        if (snap.empty) break;

        let batch = writeBatch(db);
        let writes = 0;

        for (const d of snap.docs) {
          const data = d.data() as any;

          // já tem novo status válido?
          const jaTemNovo = !!data?.aprovacao?.status &&
            ['nao_verificado', 'apto', 'inapto'].includes(
              normalizeBasic(String(data.aprovacao.status))
            );

          if (jaTemNovo) {
            this.migracaoProcessados++;
            continue;
          }

          const alvo = mapLegacyToNovo(data?.statusAprovacao);
          const patch: any = {
            aprovacao: {
              ...(data?.aprovacao || {}),
              status: alvo || 'nao_verificado',
            }
          };

          batch.set(d.ref, patch, { merge: true });
          writes++;
          this.migracaoProcessados++;

          if (writes >= batchMax) {
            await batch.commit();
            batch = writeBatch(db);
            writes = 0;
          }
        }

        if (writes > 0) await batch.commit();
        if (snap.size < pageSize) break;
        last = snap.docs[snap.docs.length - 1];
      }

      alert('Migração concluída! 🎉');
    } catch (e) {
      console.error('[Migração] Erro ao migrar aprovacao.status:', e);
      alert('Falha na migração. Veja o console para detalhes.');
    } finally {
      this.migrandoAprovacao = false;
    }
  }

  // ===== Relatório de Distribuição (modal) =====
  showRelatorioDist = false;
  abrirRelatorioDist() { this.showRelatorioDist = true; try { document.body.classList.add('no-scroll'); } catch { } }
  fecharRelatorioDist() { this.showRelatorioDist = false; try { document.body.classList.remove('no-scroll'); } catch { } }

  // helpers
  private two(n: number) { return (n < 10 ? '0' : '') + n; }
  private dayStart(d: Date | null): Date | null {
    if (!d) return null;
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  private digits(s: any): string { return String(s ?? '').replace(/\D+/g, ''); }
  cpfMask(val?: string | null): string {
    const d = this.digits(val);
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  // Base: só itens distribuídos (respeita filtros atuais -> this.view)
  private distBase() {
    return (this.view || []).filter(r => !!r.designadoEm && !!r.designadoParaUid);
  }

  // Distribuições por dia (ordem desc) – apenas totais
  distPorDia(): Array<{ key: string; label: string; total: number; dt: Date | null }> {
    const map = new Map<string, { key: string; label: string; total: number; dt: Date | null }>();
    for (const r of this.distBase()) {
      const d0 = this.dayStart(r.designadoEm || null);
      const key = d0 ? `${d0.getFullYear()}-${this.two(d0.getMonth() + 1)}-${this.two(d0.getDate())}` : '—';
      let slot = map.get(key);
      if (!slot) {
        slot = { key, label: d0 ? d0.toLocaleDateString('pt-BR') : '—', total: 0, dt: d0 };
        map.set(key, slot);
      }
      slot.total++;
    }
    return Array.from(map.values()).sort((a, b) => (b.dt?.getTime() ?? -1) - (a.dt?.getTime() ?? -1));
  }

  // Ordenação por distribuição desc
  ordenarPorDistribuicaoDesc<T extends { designadoEm?: Date | null }>(arr: T[]): T[] {
    return [...(arr || [])].sort((a, b) => (b.designadoEm?.getTime() ?? 0) - (a.designadoEm?.getTime() ?? 0));
  }

  // Agrupar por dia com itens
  gruposDistPorDia(): DistGroup[] {
    const map = new Map<string, DistGroup>();
    for (const r of this.distBase()) {
      const d0 = this.dayStart(r.designadoEm || null);
      const key = d0 ? `${d0.getFullYear()}-${this.two(d0.getMonth() + 1)}-${this.two(d0.getDate())}` : '—';
      let g = map.get(key);
      if (!g) {
        g = { key, label: d0 ? d0.toLocaleDateString('pt-BR') : '—', dt: d0, itens: [] };
        map.set(key, g);
      }
      if (!r.designadoParaNome && r.designadoParaUid) {
        r.designadoParaNome = this.resolveAssessorNome(r.designadoParaUid) || r.designadoParaUid;
      }
      g.itens.push(r);
    }
    const grupos = Array.from(map.values())
      .sort((a, b) => (b.dt?.getTime() ?? -1) - (a.dt?.getTime() ?? -1));
    grupos.forEach(g => g.itens = this.ordenarPorDistribuicaoDesc(g.itens));
    return grupos;
  }

  // Distribuições por assessor (ordem por total desc, depois nome)
  distPorAssessor(): Array<{ uid: string; nome: string; total: number }> {
    const map = new Map<string, { uid: string; nome: string; total: number }>();
    for (const r of this.distBase()) {
      const uid = String(r.designadoParaUid);
      const nome = r.designadoParaNome || this.resolveAssessorNome(uid) || uid;
      let slot = map.get(uid);
      if (!slot) { slot = { uid, nome, total: 0 }; map.set(uid, slot); }
      slot.total++;
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  }

  // Total geral de distribuições (após filtros)
  distTotal(): number { return this.distBase().length; }

  // ===== Exportar PDF – Relatório de Distribuição =====
  exportarRelatorioDistribuicaoPDF() {
    const grupos = this.gruposDistPorDia();
    const docPdf = new jsPDF({ orientation: 'p', unit: 'pt' });

    docPdf.setFontSize(14);
    docPdf.text('Relatório de Distribuição – Pré-cadastros', 40, 40);
    docPdf.setFontSize(10);
    docPdf.text(`Total de distribuições (após filtros): ${this.distTotal()}`, 40, 58);

    let startY = 80;

    if (!grupos.length) {
      docPdf.text('Nenhuma distribuição encontrada para os filtros atuais.', 40, startY);
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const fname = `relatorio-distribuicao-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.pdf`;
      docPdf.save(fname);
      return;
    }

    for (const g of grupos) {
      autoTable(docPdf, {
        startY,
        head: [[`Dia: ${g.label}  (${g.itens.length})`, '', '', '', '']],
        body: [],
        theme: 'plain',
        styles: { fontSize: 11 }
      });
      startY = (docPdf as any).lastAutoTable.finalY + 4;

      autoTable(docPdf, {
        startY,
        head: [['#', 'Cliente', 'CPF', 'Distribuído em', 'Assessor']],
        body: g.itens.map((it, idx) => {
          const dt = it.designadoEm ? it.designadoEm : null;
          return [
            String(idx + 1),
            it.nome || '',
            this.cpfMask(it.cpf),
            dt ? dt.toLocaleString() : '—',
            it.designadoParaNome || it.designadoParaUid || ''
          ];
        }),
        styles: { fontSize: 9 },
        columnStyles: {
          0: { halign: 'center', cellWidth: 28 },
          2: { cellWidth: 110 },
          3: { cellWidth: 140 }
        }
      });

      startY = (docPdf as any).lastAutoTable.finalY + 16;
    }

    const ts = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fname = `relatorio-distribuicao-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.pdf`;
    docPdf.save(fname);
  }
}
