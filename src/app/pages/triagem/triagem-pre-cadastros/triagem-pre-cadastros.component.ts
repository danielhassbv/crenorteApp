// src/app/pages/triagem/triagem-pre-cadastros/triagem-pre-cadastros.component.ts
import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  // panfleto
  'panfleto': 'panfleto', 'panfletos': 'panfleto',
  // online / site / formulário
  'online': 'online', 'on-line': 'online', 'site': 'online',
  'formulario': 'online', 'formulário': 'online',
  // telefone/celular
  'telefone': 'telefone', 'tel': 'telefone', 'celular': 'telefone', 'cel': 'telefone',
  // whatsapp
  'whatsapp': 'whatsapp', 'wpp': 'whatsapp', 'zap': 'whatsapp', 'wtz': 'whatsapp', 'whats': 'whatsapp',
  // igreja
  'igreja': 'igreja',
  // presencial / visita / cadastro presencial
  'presencial': 'presencial', 'visita': 'presencial', 'visita presencial': 'presencial', 'cadastro presencial': 'presencial',
  // indicação
  'indicacao': 'indicacao', 'indicação': 'indicacao',
  // próprio/própria
  'proprio': 'proprio', 'próprio': 'proprio', 'propria': 'proprio', 'própria': 'proprio',
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

function canonicalizeOrigem(raw: string): { key: string; label: string } {
  const n = normalizeBasic(raw);

  if (n in ORIGEM_SYNONYMS) {
    const key = ORIGEM_SYNONYMS[n];
    return { key, label: ORIGEM_LABELS[key] || titleCase(key) };
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

  origem: string;        // texto bruto
  origemKey: string;     // chave canônica
  origemLabel: string;   // rótulo canônico

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
type StatusKey  = 'todos' | 'enviados' | 'nao';

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
  openFilters() { this.showFilters = true; try { document.body.classList.add('no-scroll'); } catch {} }
  closeFilters() { this.showFilters = false; try { document.body.classList.remove('no-scroll'); } catch {} }

  // Estado de colapso por grupo
  filterOpen: Record<'status'|'periodo'|'origem'|'bairros', boolean> = {
    status: true, periodo: false, origem: true, bairros: false
  };
  toggleGroup(k: 'status'|'periodo'|'origem'|'bairros') {
    this.filterOpen[k] = !this.filterOpen[k];
    this.persistFilterUI();
  }
  isOpen(k: 'status'|'periodo'|'origem'|'bairros') { return this.filterOpen[k]; }
  private persistFilterUI() {
    try { localStorage.setItem('triagemFilterOpen', JSON.stringify(this.filterOpen)); } catch {}
  }
  private loadFilterUI() {
    try {
      const raw = localStorage.getItem('triagemFilterOpen');
      if (raw) this.filterOpen = { ...this.filterOpen, ...JSON.parse(raw) };
    } catch {}
  }

  // filtros
  busca = '';
  filtroRota = ''; // opcional
  somenteNaoDesignados = false; // espelha statusFilter = 'nao'

  // filtros agregados
  origens: Array<{ key: string; label: string; count: number }> = [];
  filtroOrigemKey = '';

  topBairros: Array<{ label: string; count: number }> = [];
  filtroBairro = '';

  statusFilter: StatusKey = 'todos';
  periodoFilter: PeriodoKey = 'todos';

  // dados
  private unsub?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];

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

  async ngOnInit(): Promise<void> {
    this.loadFilterUI();
    await this.carregarAssessores();
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

            origem: origemRaw,
            origemKey: canon.key,
            origemLabel: canon.label,

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

  private async carregarAssessores() {
    try {
      const col = collection(db, 'colaboradores');
      const q1 = query(col, where('status', '==', 'ativo'), where('papel', 'in', ['assessor', 'admin']));
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
    this.aplicarFiltros();
  }

  // status
  setStatus(k: StatusKey) {
    this.statusFilter = (this.statusFilter === k ? 'todos' : k);
    this.somenteNaoDesignados = this.statusFilter === 'nao';
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
      const label = r.origemLabel || ORIGEM_LABELS[key] || 'Outros';
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

    if (this.statusFilter === 'nao') list = list.filter(p => !this.isEnviado(p) && !p._eDeAssessor);
    if (this.statusFilter === 'enviados') list = list.filter(p => this.isEnviado(p));

    if (this.periodoFilter !== 'todos') {
      const now = new Date();
      const start = new Date(); start.setHours(0,0,0,0);
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
  }

  /* ============ Enviar/Atualizar ============ */
  async designarParaAssessor(r: PreCadastroRow) {
    const uid = this.selecaoAssessor[r.id];
    if (!uid) return;

    this.designando[r.id] = true;
    this.errDesignado[r.id] = false;

    try {
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador (assessor) não encontrado.');

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
    this.showAssessorModal = true;
  }
  fecharModalAssessor() {
    this.showAssessorModal = false;
    this.rowSelecionado = null;
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
    this.fecharModalAssessor();
  }
  async escolherEEnviar(a: Assessor) {
    if (!this.rowSelecionado) return;
    this.selecaoAssessor[this.rowSelecionado.id] = a.uid;
    this.selecaoAssessorNome[this.rowSelecionado.id] = this.nomeAssessor(a);
    const row = this.rowSelecionado;
    this.fecharModalAssessor();
    await this.designarParaAssessor(row);
  }
}
