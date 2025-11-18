import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HeaderComponent } from '../shared/header/header.component';

// Firestore
import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  Unsubscribe,
  getDocs,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  limit,
  writeBatch,
  documentId,
} from 'firebase/firestore';

import { db } from '../../firebase.config';

// Auth
import { getAuth, User } from 'firebase/auth';

// Grupos (service / model) – ajuste os caminhos se necessário
import { GrupoSolidarioService } from '../../services/grupo-solidario.service';
import { GrupoSolidario } from '../../models/grupo-solidario.model';

/** ===== Tipos base ===== */
export type Papel =
  | 'admin'
  | 'supervisor'
  | 'coordenador'
  | 'assessor'
  | 'analista'
  | 'operacional'
  | 'rh'
  | 'financeiro'
  | 'qualidade';

export interface Colaborador {
  uid: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  rota: string;
  status: 'ativo' | 'inativo';
  supervisorId?: string | null;
  analistaId?: string | null;
  cpf?: string | null;
  telefone?: string | null;
  photoURL?: string | null;
  criadoEm: number;
  id?: string;
}

type StatusAprovacao = 'nao' | 'apto' | 'inapto';

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

  statusAprovacao?: StatusAprovacao;

  designadoEm?: Date | null;
  designadoParaUid?: string | null;
  designadoParaNome?: string | null;

  // ➕ NOVO: controle de encaminhamento
  encaminhadoParaUid?: string | null;
  encaminhadoParaNome?: string | null;
  encaminhadoEm?: Date | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;

  _path: string;
  _eDeAssessor?: boolean;

  createdByUid?: string | null;
  createdByNome?: string | null;

  caixaAtual?: string | null;
  caixaUid?: string | null;
};

export type StatusGrupo = 'em_qa' | 'aprovado_basa' | 'reprovado_basa';

/**
 * Mantém o slim que você já usava, mas agora com campos de "view"
 * que vêm do joinGruposView (coordenadorView, membrosView, metrics).
 */
type GrupoSlim = {
  id: string;
  codigo?: string;
  coordenadorCpf?: string;
  coordenadorNome?: string;

  membrosIds: string[];
  membrosRaw?: any[];

  bairro: string;
  cidade: string;
  estado: string;
  status: StatusGrupo;
  criadoEm: Date | null;
  criadoPorUid: string | null;
  criadoPorNome: string | null;
  totalSolicitado: number;
  observacoes: string;
  designadoEm: Date | null;
  designadoParaUid: string | null;
  designadoParaNome: string | null;

  encaminhadoParaUid?: string | null;
  encaminhadoParaNome?: string | null;
  encaminhadoEm?: Date | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;

  caixaAtual: string | null;
  caixaUid: string | null;

  // ➕ campos "view" vindos do joinGruposView
  membrosView?: any[];
  coordenadorView?: any;
  metrics?: {
    agendados?: number;
    visitados?: number;
    formalizados?: number;
    desistentes?: number;
    [k: string]: any;
  };
};

type Assessor = {
  uid: string;
  nome?: string;
  email?: string;
  status?: string;
  papel?: string;
  rota?: string;
};

/** ===== Helpers ===== */
function normalizeBasic(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDateSafe(v: any): Date | null {
  try {
    if (!v) return null;
    if (typeof v?.toDate === 'function') return v.toDate();
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
  } catch {}
  return null;
}

function statusFrom(x: any): StatusAprovacao {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao';
}

function normCpf(v: any): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/** ====== Componente ====== */
@Component({
  standalone: true,
  selector: 'app-triagem-supervisao',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './triagem-supervisao.component.html',
  styleUrls: ['./triagem-supervisao.component.css'],
})
export class TriagemSupervisaoComponent implements OnInit, OnDestroy {
  /** ========== Estado base / UI ========== */
  carregando = signal(false);
  erro = signal<string | null>(null);

  // service de grupos (joinGruposView)
  private gruposSvc = inject(GrupoSolidarioService);

  // Usuário atual (supervisor/analista)
  me: Pick<Colaborador, 'uid' | 'papel' | 'nome'> | null = null;

  // Pessoas
  private unsubPC?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];
  pcById = new Map<string, PreCadastroRow>();

  // Grupos
  private unsubGrupos?: Unsubscribe;
  allGrupos: GrupoSlim[] = [];
  viewGrupos: GrupoSlim[] = [];

  // Assessores do meu time
  assessores: Assessor[] = [];
  assessoresFiltrados: Assessor[] = [];
  assessoresFiltradosGrupo: Assessor[] = [];

  // Modal/seleções
  showAssessorModal = false;
  rowSelecionado: PreCadastroRow | null = null;
  selectedAssessorUid: string | null = null;

  showAssessorModalGrupo = false;
  grupoSelecionado: GrupoSlim | null = null;
  selectedAssessorUidGrupo: string | null = null;

  // modal de detalhe de grupo
  showGrupoDetalhe = false;
  membrosPC: PreCadastroRow[] = [];

  // campos de busca nos modais
  assessorBusca: string = '';
  assessorBuscaGrupo: string = '';

  // Filtros simples
  activeTab: 'pessoas' | 'grupos' = 'pessoas';
  busca = '';

  // “Encaminhado / Não encaminhado”
  envioFilter: 'todos' | 'encaminhado' | 'nao_encaminhado' = 'todos';

  statusFilter: StatusAprovacao | 'todos' = 'todos';

  // paginação pessoas
  pageSize = 20;
  currentPage = 1;
  get totalItems() {
    return this.view.length;
  }
  get totalPages() {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }
  get pageStart() {
    return this.totalItems ? (this.currentPage - 1) * this.pageSize : 0;
  }
  get pageEnd() {
    return Math.min(this.pageStart + this.pageSize, this.pageSize * this.currentPage);
  }
  get pageItems() {
    return this.view.slice(this.pageStart, this.pageEnd);
  }

  // paginação grupos
  pageSizeG = 20;
  currentPageG = 1;
  get totalItemsG() {
    return this.viewGrupos.length;
  }
  get totalPagesG() {
    return Math.max(1, Math.ceil(this.totalItemsG / this.pageSizeG));
  }
  get pageStartG() {
    return this.totalItemsG ? (this.currentPageG - 1) * this.pageSizeG : 0;
  }
  get pageEndG() {
    return Math.min(this.pageStartG + this.pageSizeG, this.pageSizeG * this.currentPageG);
  }
  get pageItemsG() {
    return this.viewGrupos.slice(this.pageStartG, this.pageEndG);
  }

  /** Limites “sem índice” */
  private readonly PC_LIMIT = 1200;
  private readonly GRUPOS_LIMIT = 600;

  ngOnInit(): void {
    this.carregando.set(true);
    this.initMeAndBootstrap();
  }

  ngOnDestroy(): void {
    this.unsubPC?.();
    this.unsubGrupos?.();
  }

  /** Resolve o usuário (me) e só então carrega dados */
  private async initMeAndBootstrap() {
    try {
      const auth = getAuth();
      const authUser: User | null = auth.currentUser;

      if (authUser?.uid) {
        const meSnap = await getDoc(doc(db, 'colaboradores', authUser.uid));
        if (meSnap.exists()) {
          const x = meSnap.data() as any;
          this.me = {
            uid: authUser.uid,
            papel: x?.papel || 'supervisor',
            nome: x?.nome || authUser.displayName || '',
          };
        } else {
          this.me = {
            uid: authUser.uid,
            papel: 'supervisor',
            nome: authUser.displayName || '',
          };
        }
      } else {
        const lsUid = localStorage.getItem('meUid') || '';
        const lsPapel = (localStorage.getItem('mePapel') as Papel) || 'supervisor';
        if (lsUid) {
          this.me = {
            uid: lsUid,
            papel: lsPapel,
            nome: localStorage.getItem('meNome') || '',
          };
        } else {
          this.me = null;
        }
      }

      await this.carregarAssessoresDoMeuTime();
      this.carregarPreCadastrosSemIndex();
      this.carregarGruposSemIndiceComFiltroSeguro();
    } catch (e) {
      console.error('[Triagem-supervisão] falha ao inicializar:', e);
      this.erro.set('Falha ao inicializar a triagem.');
    } finally {
      this.carregando.set(false);
    }
  }

  /** ===== Assessores do meu time (subordinados) ===== */
  private async carregarAssessoresDoMeuTime(): Promise<void> {
    try {
      const meUid = this.me?.uid || null;
      if (!meUid) {
        this.assessores = [];
        return;
      }

      const col = collection(db, 'colaboradores');

      // assessores cujo supervisorId == meUid
      const qSup = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', '==', 'assessor'),
        where('supervisorId', '==', meUid)
      );
      const supSnap = await getDocs(qSup);

      // assessores cujo analistaId == meUid
      const qAna = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', '==', 'assessor'),
        where('analistaId', '==', meUid)
      );
      const anaSnap = await getDocs(qAna);

      const map = new Map<string, Assessor>();
      const pushDoc = (d: any) => {
        const x = d.data() as any;
        map.set(d.id, {
          uid: d.id,
          nome: x?.nome ?? x?.displayName ?? '',
          email: x?.email ?? '',
          status: x?.status,
          papel: x?.papel,
          rota: x?.rota ?? '',
        });
      };

      supSnap.docs.forEach(pushDoc);
      anaSnap.docs.forEach(pushDoc);

      this.assessores = Array.from(map.values()).sort((a, b) =>
        (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? '')
      );

      this.assessoresFiltrados = [...this.assessores];
      this.assessoresFiltradosGrupo = [...this.assessores];
    } catch (e) {
      console.warn('[Triagem] Falha ao carregar subordinados do supervisor/analista', e);
      this.assessores = [];
      this.assessoresFiltrados = [];
      this.assessoresFiltradosGrupo = [];
    }
  }

  /** ================================
   *  PRÉ-CADASTROS — SEM ÍNDICE
   *  ================================ */
  private carregarPreCadastrosSemIndex(): void {
    this.unsubPC?.();

    const base = collectionGroup(db, 'pre_cadastros');
    const qy = query(base, limit(this.PC_LIMIT)); // sem where => sem índice composto

    this.unsubPC = onSnapshot(
      qy,
      (snap) => {
        try {
          const rows: PreCadastroRow[] = snap.docs.map((d) => {
            const x = d.data() as any;

            const origemRaw = String(x?.origem ?? '').trim();
            const origemKey = normalizeBasic(origemRaw || 'outros');
            const origemLabel = origemRaw || 'Outros';

            const designadoParaUid: string | null =
              (x?.designadoParaUid ?? x?.designadoPara ?? null) || null;
            const designadoParaNome: string | null = x?.designadoParaNome ?? null;

            const r: PreCadastroRow = {
              id: d.id,
              data: toDateSafe(x?.createdAt ?? x?.criadoEm),
              nome: String(x?.nomeCompleto ?? x?.nome ?? '').trim(),
              cpf: String(x?.cpf ?? '').trim(),
              telefone: String(x?.telefone ?? x?.contato ?? '').trim(),
              email: String(x?.email ?? '').trim(),
              endereco: String(x?.endereco ?? x?.enderecoCompleto ?? '').trim(),
              bairro: String(x?.bairro ?? '').trim(),
              rota: String(x?.rota ?? '').trim(),
              cidade: String(x?.cidade ?? '').trim(),
              uf: String(x?.uf ?? x?.estado ?? '').trim(),

              origem: origemLabel,
              origemKey,
              origemLabel,

              statusAprovacao: statusFrom(x?.aprovacao?.status ?? x?.statusAprovacao),

              designadoEm: toDateSafe(x?.designadoEm) ?? null,
              designadoParaUid,
              designadoParaNome,

              // 🔽 NOVOS campos vindo do firestore
              encaminhadoParaUid: x?.encaminhadoParaUid ?? null,
              encaminhadoParaNome: x?.encaminhadoParaNome ?? null,
              encaminhadoEm: toDateSafe(x?.encaminhadoEm) ?? null,
              encaminhadoPorUid: x?.encaminhadoPorUid ?? null,
              encaminhadoPorNome: x?.encaminhadoPorNome ?? null,

              _path: d.ref.path,
              _eDeAssessor: d.ref.path.startsWith('colaboradores/'),

              createdByUid: x?.createdByUid ?? null,
              createdByNome: x?.createdByNome ?? null,

              caixaAtual: x?.caixaAtual ?? null,
              caixaUid: x?.caixaUid ?? null,
            };
            return r;
          });

          const meuUid = this.me?.uid || null;

          // ✅ Regra da central de triagem:
          // - entra se AINDA está na minha caixa (caixaUid == me)
          //   OU se foi encaminhado por mim (encaminhadoPorUid == me)
          const baseList = rows
            .filter((r) => {
              if (!meuUid) return false;
              const emMinhaCaixa = r.caixaUid === meuUid;
              const encaminhadoPorMim = r.encaminhadoPorUid === meuUid;
              return emMinhaCaixa || encaminhadoPorMim;
            })
            .sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

          // 👇 Índice com TODOS os pré-cadastros carregados (rows), não só os filtrados
          this.pcById.clear();
          for (const r of rows) this.pcById.set(r.id, r);

          // 🔁 Garante que todos os membros dos grupos da minha caixa também apareçam na aba Pessoas
          this.all = this.mergePessoasComGrupos(baseList);

          this.aplicarFiltrosPessoas();
        } catch (e) {
          console.error('[Triagem] Falha ao mapear pré-cadastros:', e);
          this.erro.set('Falha ao processar pré-cadastros.');
        }
      },
      (err) => {
        console.error('[Triagem] Snapshot pré-cadastros (sem índice) falhou:', err);
        this.erro.set('Falha ao carregar pré-cadastros.');
      }
    );
  }

  /** =========================================
   *  GRUPOS — sem índice composto + joinGruposView
   *  ========================================= */
  private carregarGruposSemIndiceComFiltroSeguro(): void {
    this.unsubGrupos?.();

    const colRef = collection(db, 'grupos_solidarios');
    const qy = query(colRef, limit(this.GRUPOS_LIMIT));

    this.unsubGrupos = onSnapshot(
      qy,
      async (snap) => {
        try {
          const meuUid = this.me?.uid || null;

          // 1) Mapear docs do Firestore para um objeto base
          const baseArr: GrupoSlim[] = snap.docs.map((d): GrupoSlim => {
            const x = d.data() as any;

            const membrosIds: string[] = Array.isArray(x?.membrosIds)
              ? x.membrosIds
              : [];
            const membrosRaw: any[] = Array.isArray(x?.membros) ? x.membros : [];

            return {
              id: String(d.id),
              codigo: x?.codigo,
              coordenadorCpf: x?.coordenadorCpf ?? undefined,
              coordenadorNome: x?.coordenadorNome ?? undefined,

              membrosIds,
              membrosRaw,

              bairro: x?.bairro || '',
              cidade: x?.cidade || '',
              estado: x?.estado || x?.uf || '',
              status: (x?.status || 'em_qa') as StatusGrupo,
              criadoEm: toDateSafe(x?.criadoEm) || new Date(),
              criadoPorUid: x?.criadoPorUid ?? null,
              criadoPorNome: x?.criadoPorNome ?? null,
              totalSolicitado: x?.totalSolicitado || 0,
              observacoes: x?.observacoes || '',
              designadoEm: toDateSafe(x?.designadoEm) || null,
              designadoParaUid: x?.designadoParaUid || null,
              designadoParaNome: x?.designadoParaNome || null,

              encaminhadoParaUid: x?.encaminhadoParaUid ?? null,
              encaminhadoParaNome: x?.encaminhadoParaNome ?? null,
              encaminhadoEm: toDateSafe(x?.encaminhadoEm) ?? null,
              encaminhadoPorUid: x?.encaminhadoPorUid ?? null,
              encaminhadoPorNome: x?.encaminhadoPorNome ?? null,

              caixaAtual: x?.caixaAtual ?? null,
              caixaUid: x?.caixaUid ?? null,

              membrosView: undefined,
              coordenadorView: undefined,
              metrics: undefined,
            };
          });

          // 2) Filtro de "caixa" do supervisor/analista (igual sua regra antiga)
          let list = baseArr;
          if (meuUid) {
            list = baseArr.filter((g) => {
              const emMinhaCaixa = g.caixaUid === meuUid;
              const encaminhadoPorMim = g.encaminhadoPorUid === meuUid;
              return emMinhaCaixa || encaminhadoPorMim;
            });
          } else {
            list = [];
          }

          // 3) Ordena por data de criação (mais recente primeiro)
          list.sort(
            (a, b) =>
              (b.criadoEm?.getTime?.() || 0) - (a.criadoEm?.getTime?.() || 0)
          );

          // 4) Enriquecer com joinGruposView (padrão da Minha Lista)
          const joined = await this.gruposSvc.joinGruposView(
            list as unknown as GrupoSolidario[]
          );

          const enriched: GrupoSlim[] = (joined as any[]).map((g: any) => ({
            id: String(g.id),
            codigo: g.codigo,
            coordenadorCpf: g.coordenadorCpf ?? undefined,
            coordenadorNome: g.coordenadorNome ?? undefined,

            membrosIds: Array.isArray(g.membrosIds) ? g.membrosIds : [],
            membrosRaw: Array.isArray(g.membrosRaw)
              ? g.membrosRaw
              : Array.isArray(g.membros)
              ? g.membros
              : [],

            bairro: g.bairro || '',
            cidade: g.cidade || '',
            estado: g.estado || g.uf || '',
            status: (g.status || 'em_qa') as StatusGrupo,
            criadoEm: toDateSafe(g.criadoEm) || new Date(),
            criadoPorUid: g.criadoPorUid ?? null,
            criadoPorNome: g.criadoPorNome ?? null,
            totalSolicitado: g.totalSolicitado || 0,
            observacoes: g.observacoes || '',
            designadoEm: toDateSafe(g.designadoEm) || null,
            designadoParaUid: g.designadoParaUid || null,
            designadoParaNome: g.designadoParaNome || null,

            encaminhadoParaUid: g.encaminhadoParaUid ?? null,
            encaminhadoParaNome: g.encaminhadoParaNome ?? null,
            encaminhadoEm: toDateSafe(g.encaminhadoEm) ?? null,
            encaminhadoPorUid: g.encaminhadoPorUid ?? null,
            encaminhadoPorNome: g.encaminhadoPorNome ?? null,

            caixaAtual: g.caixaAtual ?? null,
            caixaUid: g.caixaUid ?? null,

            membrosView: g.membrosView,
            coordenadorView: g.coordenadorView,
            metrics: g.metrics,
          }));

          // 5) Ordena de novo por criadoEm só por garantia
          enriched.sort(
            (a, b) =>
              (b.criadoEm?.getTime?.() || 0) - (a.criadoEm?.getTime?.() || 0)
          );

          this.allGrupos = enriched;
          this.filtrarGrupos();

          // 🔁 Sempre que os grupos mudam, remerge os membros na lista de Pessoas
          this.all = this.mergePessoasComGrupos(this.all);
          this.aplicarFiltrosPessoas();
        } catch (e) {
          console.error('[Triagem] Falha ao mapear grupos (joinGruposView):', e);
          this.erro.set('Falha ao processar grupos.');
        }
      },
      (err) => {
        console.error('[Triagem] Snapshot de grupos falhou:', err);
        this.erro.set('Falha ao carregar grupos.');
      }
    );
  }

  /** ===== Filtros Pessoas ===== */
  aplicarFiltrosPessoas(): void {
    let list = [...this.all];

    // “Encaminhado / Não encaminhado”
    if (this.envioFilter !== 'todos') {
      list = list.filter((p) => {
        const enc = !!p.encaminhadoParaUid;
        return this.envioFilter === 'encaminhado' ? enc : !enc;
      });
    }

    if (this.statusFilter !== 'todos') {
      list = list.filter(
        (p) => (p.statusAprovacao || 'nao') === this.statusFilter
      );
    }

    const term = normalizeBasic(this.busca);
    if (term) {
      list = list.filter((p) => {
        const blob = normalizeBasic(
          `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.cidade} ${p.uf} ${p.origemLabel}`
        );
        return blob.includes(term);
      });
    }

    list.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

    this.view = list;
    this.currentPage = 1;
  }

  filtrarGrupos(): void {
    const term = normalizeBasic(this.busca);
    let list = [...this.allGrupos];

    if (term) {
      list = list.filter((g) => {
        const blob = normalizeBasic(
          `${g.codigo || ''} ${g.coordenadorNome || ''} ${g.bairro || ''} ${g.cidade || ''} ${g.estado || ''}`
        );
        return blob.includes(term);
      });
    }

    this.viewGrupos = list;
    this.currentPageG = 1;
  }

  setTab(tab: 'pessoas' | 'grupos') {
    this.activeTab = tab;
    if (tab === 'pessoas') this.aplicarFiltrosPessoas();
    else this.filtrarGrupos();
  }

  onBusca(v: string) {
    this.busca = (v ?? '').trim();
    if (this.activeTab === 'pessoas') this.aplicarFiltrosPessoas();
    else this.filtrarGrupos();
  }

  setStatus(k: StatusAprovacao | 'todos') {
    this.statusFilter = this.statusFilter === k ? 'todos' : k;
    this.aplicarFiltrosPessoas();
  }

  // valores: 'encaminhado' | 'nao_encaminhado'
  setEnvio(k: 'todos' | 'encaminhado' | 'nao_encaminhado') {
    this.envioFilter = this.envioFilter === k ? 'todos' : k;
    this.aplicarFiltrosPessoas();
  }

  /** ===== trackBy ===== */
  trackById(_i: number, r: { id?: string } | null): string | undefined {
    return r?.id;
  }
  trackByGrupoId(_i: number, g: { id?: string } | null): string | undefined {
    return g?.id;
  }

  /** ===== UI helpers (pessoas) ===== */
  statusLabel(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto':
        return 'Apto';
      case 'inapto':
        return 'Inapto';
      default:
        return 'Não verificado';
    }
  }

  statusIcon(s?: StatusAprovacao | null): string {
    switch (s) {
      case 'apto':
        return '✅';
      case 'inapto':
        return '⛔';
      default:
        return '🕑';
    }
  }

  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  /** ===== UI helpers (grupos) ===== */
  grupoStatusChipClass(st?: StatusGrupo | null): string {
    switch (st) {
      case 'aprovado_basa':
        return 'bg-success';
      case 'reprovado_basa':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }

  grupoStatusIcon(st?: StatusGrupo | null): string {
    switch (st) {
      case 'aprovado_basa':
        return '✅';
      case 'reprovado_basa':
        return '⛔';
      default:
        return '🕑';
    }
  }

  grupoStatusLabel(st?: StatusGrupo | null): string {
    switch (st) {
      case 'aprovado_basa':
        return 'Aprovado BASA';
      case 'reprovado_basa':
        return 'Reprovado BASA';
      default:
        return 'Em QA';
    }
  }

  /**
   * Constrói a lista de membros de um grupo, tentando sempre
   * reaproveitar o pré-cadastro REAL (pcById) antes de cair no raw.
   */
  private buildMembrosFromGrupo(g: GrupoSlim): PreCadastroRow[] {
    const membrosView: any[] = Array.isArray((g as any).membrosView)
      ? (g as any).membrosView
      : [];

    const membrosRaw: any[] = Array.isArray((g as any).membrosRaw)
      ? (g as any).membrosRaw
      : Array.isArray((g as any).membros)
      ? (g as any).membros
      : [];

    const membrosIdsRaw: string[] = Array.isArray(g.membrosIds)
      ? g.membrosIds
      : [];

    const membros: PreCadastroRow[] = [];

    const idSet = new Set<string>(); // pra não repetir por ID
    const cpfSet = new Set<string>(); // pra não repetir por CPF

    // mapa auxiliar por CPF, usando os pré-cadastros reais
    const pcByCpf = new Map<string, PreCadastroRow>();
    this.pcById.forEach((row) => {
      const k = normCpf(row.cpf);
      if (k && !pcByCpf.has(k)) pcByCpf.set(k, row);
    });

    // ===== 1) MONTA A PARTIR DO membrosView (PRIORITÁRIO) =====
    membrosView.forEach((mv, index) => {
      const rawId = mv?.preCadastroId || mv?.cadastroId || mv?.id || '';
      let id = String(rawId || '').trim();
      const cpfKey = normCpf(mv?.cpf);

      let pc: PreCadastroRow | undefined;

      if (id) pc = this.pcById.get(id);
      if (!pc && cpfKey) pc = pcByCpf.get(cpfKey);

      if (!pc) {
        if (!id) id = cpfKey ? `cpf-${cpfKey}` : `view-${index}`;
        pc = this.mapRawToPreCadastroRow(id, mv || {});
      }

      const finalCpfKey = normCpf(pc.cpf);

      if (id && idSet.has(id)) return;
      if (finalCpfKey && cpfSet.has(finalCpfKey)) return;

      if (id) idSet.add(id);
      if (finalCpfKey) cpfSet.add(finalCpfKey);

      membros.push(pc);
    });

    // ===== 2) COMPLETA COM membrosIds QUE NÃO ESTÃO NO membrosView =====
    membrosIdsRaw.forEach((rawId) => {
      const id = String(rawId || '').trim();
      if (!id || idSet.has(id)) return;

      let pc = this.pcById.get(id);
      if (!pc) {
        const raw = membrosRaw.find(
          (m: any) =>
            m?.cadastroId === id || m?.preCadastroId === id || m?.id === id
        );
        pc = this.mapRawToPreCadastroRow(id, raw || {});
      }

      const cpfKey = normCpf(pc.cpf);
      if (cpfKey && cpfSet.has(cpfKey)) return;

      idSet.add(id);
      if (cpfKey) cpfSet.add(cpfKey);

      membros.push(pc);
    });

    return membros;
  }

  /**
   * Pega a lista base de Pessoas (já com regra de caixa)
   * e garante que todos os membros dos grupos visíveis
   * também entrem nessa lista.
   */
  private mergePessoasComGrupos(baseList: PreCadastroRow[]): PreCadastroRow[] {
    const result = [...baseList];
    const existing = new Set(result.map((p) => p.id));

    for (const g of this.allGrupos) {
      const membros = this.buildMembrosFromGrupo(g);
      for (const pc of membros) {
        if (!pc?.id || existing.has(pc.id)) continue;
        result.push(pc);
        existing.add(pc.id);
      }
    }

    return result;
  }

  private aplicarEncaminhamentoEmPessoasPorGrupo(
    g: GrupoSlim,
    aUid: string,
    assessorNome: string | null,
    meUid: string | null,
    meNome: string | null
  ) {
    const ids = g.membrosIds || [];
    const now = new Date();

    for (const id of ids) {
      const pc = this.pcById.get(id);
      if (!pc) continue;

      const patch: Partial<PreCadastroRow> = {
        designadoParaUid: aUid,
        designadoParaNome: assessorNome || '',
        designadoEm: now,

        encaminhadoParaUid: aUid,
        encaminhadoParaNome: assessorNome || '',
        encaminhadoEm: now,
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome || undefined,

        caixaAtual: 'assessor',
        caixaUid: aUid,
      };

      const idx = this.all.findIndex((x) => x.id === pc.id);
      if (idx >= 0) this.all[idx] = { ...this.all[idx], ...patch };

      const idx2 = this.view.findIndex((x) => x.id === pc.id);
      if (idx2 >= 0) this.view[idx2] = { ...this.view[idx2], ...patch };
    }

    // Reaplica filtros pra refletir o novo estado (encaminhado / não encaminhado)
    this.aplicarFiltrosPessoas();
  }

  /** ===== Designar pessoas/grupos ===== */
  async designarParaAssessor(r: PreCadastroRow, uid?: string | null) {
    const aUid = uid || this.selectedAssessorUid;
    if (!r || !aUid) return;

    try {
      const colabRef = doc(db, 'colaboradores', aUid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador não encontrado.');
      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      const meUid = this.me?.uid ?? null;
      const meNome = this.me?.nome ?? null;

      const srcRef = doc(db, r._path);
      await setDoc(
        srcRef,
        {
          designadoParaUid: aUid,
          designadoPara: aUid,
          designadoParaNome: assessorNome || null,
          designadoEm: serverTimestamp(),

          // ➕ dados de encaminhamento
          encaminhadoParaUid: aUid,
          encaminhadoParaNome: assessorNome || null,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome,

          // mantém o modelo de "caixa" pro assessor receber na lista dele
          caixaAtual: 'assessor',
          caixaUid: aUid,
        },
        { merge: true }
      );

      const patch: Partial<PreCadastroRow> = {
        designadoParaUid: aUid,
        designadoParaNome: assessorNome || '',
        designadoEm: new Date(),
        encaminhadoParaUid: aUid,
        encaminhadoParaNome: assessorNome || '',
        encaminhadoEm: new Date(),
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome || undefined,
        caixaAtual: 'assessor',
        caixaUid: aUid,
      };
      const idx = this.all.findIndex((x) => x.id === r.id);
      if (idx >= 0) this.all[idx] = { ...this.all[idx], ...patch };
      const idx2 = this.view.findIndex((x) => x.id === r.id);
      if (idx2 >= 0) this.view[idx2] = { ...this.view[idx2], ...patch };

      this.aplicarFiltrosPessoas();
    } catch (e) {
      console.error('[Triagem] Falha ao designar pessoa:', e);
      alert('Não foi possível encaminhar. Tente novamente.');
    }
  }

  async designarGrupo(g: GrupoSlim, uid?: string | null) {
    const aUid = uid || this.selectedAssessorUidGrupo;
    if (!g || !aUid) return;

    try {
      const colabRef = doc(db, 'colaboradores', aUid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador não encontrado.');
      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      const meUid = this.me?.uid ?? null;
      const meNome = this.me?.nome ?? null;

      // 👇 Batch pra atualizar GRUPO + TODOS os membros
      const batch = writeBatch(db);

      // 1) Atualiza o grupo
      const refGrupo = doc(db, 'grupos_solidarios', g.id);
      batch.set(
        refGrupo,
        {
          designadoParaUid: aUid,
          designadoParaNome: assessorNome || null,
          designadoEm: serverTimestamp(),

          encaminhadoParaUid: aUid,
          encaminhadoParaNome: assessorNome || null,
          encaminhadoEm: serverTimestamp(),
          encaminhadoPorUid: meUid,
          encaminhadoPorNome: meNome,

          caixaAtual: 'assessor',
          caixaUid: aUid,
        },
        { merge: true }
      );

      // 2) Atualiza todos os pré-cadastros membros do grupo
      const ids = g.membrosIds || [];
      for (const id of ids) {
        const pc = this.pcById.get(id);
        if (!pc) continue;

        const refPc = doc(db, pc._path);
        batch.set(
          refPc,
          {
            designadoParaUid: aUid,
            designadoPara: aUid,
            designadoParaNome: assessorNome || null,
            designadoEm: serverTimestamp(),

            encaminhadoParaUid: aUid,
            encaminhadoParaNome: assessorNome || null,
            encaminhadoEm: serverTimestamp(),
            encaminhadoPorUid: meUid,
            encaminhadoPorNome: meNome,

            caixaAtual: 'assessor',
            caixaUid: aUid,
          },
          { merge: true }
        );
      }

      // 3) Aplica tudo no Firestore
      await batch.commit();

      // 4) Atualiza estado local do grupo
      const patchGrupo: Partial<GrupoSlim> = {
        designadoParaUid: aUid,
        designadoParaNome: assessorNome || '',
        designadoEm: new Date(),
        encaminhadoParaUid: aUid,
        encaminhadoParaNome: assessorNome || '',
        encaminhadoEm: new Date(),
        encaminhadoPorUid: meUid,
        encaminhadoPorNome: meNome || undefined,
        caixaAtual: 'assessor',
        caixaUid: aUid,
      };
      const idx = this.allGrupos.findIndex((x) => x.id === g.id);
      if (idx >= 0) this.allGrupos[idx] = { ...this.allGrupos[idx], ...patchGrupo };
      const idx2 = this.viewGrupos.findIndex((x) => x.id === g.id);
      if (idx2 >= 0) this.viewGrupos[idx2] = { ...this.viewGrupos[idx2], ...patchGrupo };

      // 5) Atualiza estado local das PESSOAS do grupo
      this.aplicarEncaminhamentoEmPessoasPorGrupo(
        g,
        aUid,
        assessorNome || null,
        meUid,
        meNome
      );

      // 6) Reaplica lista de grupos
      this.filtrarGrupos();
    } catch (e) {
      console.error('[Triagem] Falha ao designar grupo:', e);
      alert('Não foi possível encaminhar o grupo. Tente novamente.');
    }
  }

  /** ===== Modais ===== */
  abrirModalAssessor(row: PreCadastroRow) {
    this.rowSelecionado = row;
    this.selectedAssessorUid =
      row.encaminhadoParaUid || row.designadoParaUid || null;
    this.assessorBusca = '';
    this.assessoresFiltrados = [...this.assessores];
    this.showAssessorModal = true;
  }

  abrirModalAssessorGrupo(g: GrupoSlim) {
    this.grupoSelecionado = g;
    this.selectedAssessorUidGrupo =
      g.encaminhadoParaUid || g.designadoParaUid || null;
    this.assessorBuscaGrupo = '';
    this.assessoresFiltradosGrupo = [...this.assessores];
    this.showAssessorModalGrupo = true;
  }

  fecharModalAssessor() {
    this.showAssessorModal = false;
    this.rowSelecionado = null;
    this.selectedAssessorUid = null;
  }

  fecharModalAssessorGrupo() {
    this.showAssessorModalGrupo = false;
    this.grupoSelecionado = null;
    this.selectedAssessorUidGrupo = null;
  }

  private async carregarPreCadastroPorId(
    id: string
  ): Promise<PreCadastroRow | null> {
    try {
      const cg = collectionGroup(db, 'pre_cadastros');
      const qy = query(cg, where(documentId(), '==', id), limit(1));
      const snap = await getDocs(qy);

      if (snap.empty) return null;

      const d = snap.docs[0];
      const x = d.data() as any;

      const origemRaw = String(x?.origem ?? '').trim();
      const origemKey = normalizeBasic(origemRaw || 'outros');
      const origemLabel = origemRaw || 'Outros';

      const designadoParaUid: string | null =
        (x?.designadoParaUid ?? x?.designadoPara ?? null) || null;
      const designadoParaNome: string | null = x?.designadoParaNome ?? null;

      const r: PreCadastroRow = {
        id: d.id,
        data: toDateSafe(x?.createdAt ?? x?.criadoEm),

        nome: String(x?.nomeCompleto ?? x?.nome ?? '').trim(),
        cpf: String(x?.cpf ?? '').trim(),
        telefone: String(x?.telefone ?? x?.contato ?? '').trim(),
        email: String(x?.email ?? '').trim(),
        endereco: String(x?.endereco ?? x?.enderecoCompleto ?? '').trim(),
        bairro: String(x?.bairro ?? '').trim(),
        rota: String(x?.rota ?? '').trim(),
        cidade: String(x?.cidade ?? '').trim(),
        uf: String(x?.uf ?? x?.estado ?? '').trim(),

        origem: origemLabel,
        origemKey,
        origemLabel,

        statusAprovacao: statusFrom(x?.aprovacao?.status ?? x?.statusAprovacao),

        designadoEm: toDateSafe(x?.designadoEm) ?? null,
        designadoParaUid,
        designadoParaNome,

        encaminhadoParaUid: x?.encaminhadoParaUid ?? null,
        encaminhadoParaNome: x?.encaminhadoParaNome ?? null,
        encaminhadoEm: toDateSafe(x?.encaminhadoEm) ?? null,
        encaminhadoPorUid: x?.encaminhadoPorUid ?? null,
        encaminhadoPorNome: x?.encaminhadoPorNome ?? null,

        _path: d.ref.path,
        _eDeAssessor: d.ref.path.startsWith('colaboradores/'),

        createdByUid: x?.createdByUid ?? null,
        createdByNome: x?.createdByNome ?? null,

        caixaAtual: x?.caixaAtual ?? null,
        caixaUid: x?.caixaUid ?? null,
      };

      // guarda no mapa pra reuso
      this.pcById.set(r.id, r);
      return r;
    } catch (e) {
      console.error('Falha ao carregar pré-cadastro por id', id, e);
      return null;
    }
  }

  abrirDetalheGrupo(g: GrupoSlim) {
    this.grupoSelecionado = g;
    this.showGrupoDetalhe = true;

    const membros = this.buildMembrosFromGrupo(g);
    this.membrosPC = membros;

    // garante que estes membros também estejam na base de Pessoas
    const idsExistentes = new Set(this.all.map((p) => p.id));
    for (const pc of membros) {
      if (!pc?.id || idsExistentes.has(pc.id)) continue;
      this.all.push(pc);
      idsExistentes.add(pc.id);
    }

    this.aplicarFiltrosPessoas();
  }

  private mapRawToPreCadastroRow(id: string, raw: any): PreCadastroRow {
    return {
      id,
      data: null,

      nome: String(raw?.nomeCompleto ?? raw?.nome ?? '').trim(),
      cpf: String(raw?.cpf ?? '').trim(),
      telefone: String(raw?.telefone ?? '').trim(),
      email: String(raw?.email ?? '').trim(),
      endereco: String(raw?.endereco ?? '').trim(),
      bairro: String(raw?.bairro ?? '').trim(),
      rota: '',
      cidade: String(raw?.cidade ?? '').trim(),
      uf: String(raw?.uf ?? '').trim(),

      origem: '',
      origemKey: '',
      origemLabel: '',

      statusAprovacao: 'nao',

      designadoEm: null,
      designadoParaUid: null,
      designadoParaNome: null,

      encaminhadoParaUid: null,
      encaminhadoParaNome: null,
      encaminhadoEm: null,
      encaminhadoPorUid: null,
      encaminhadoPorNome: null,

      _path: '', // não usamos pra editar aqui
      _eDeAssessor: false,

      createdByUid: null,
      createdByNome: null,

      caixaAtual: null,
      caixaUid: null,
    };
  }

  fecharDetalheGrupo() {
    this.showGrupoDetalhe = false;
    this.grupoSelecionado = null;
    this.membrosPC = [];
  }

  /** ===== Busca nos modais ===== */
  filtrarAssessoresPessoas() {
    const term = (this.assessorBusca || '').trim().toLowerCase();
    const base = this.assessores;
    this.assessoresFiltrados = term
      ? base.filter((a) =>
          `${a.nome ?? ''} ${a.email ?? ''} ${a.rota ?? ''}`
            .toLowerCase()
            .includes(term)
        )
      : [...base];
  }

  filtrarAssessoresGrupo() {
    const term = (this.assessorBuscaGrupo || '').trim().toLowerCase();
    const base = this.assessores;
    this.assessoresFiltradosGrupo = term
      ? base.filter((a) =>
          `${a.nome ?? ''} ${a.email ?? ''} ${a.rota ?? ''}`
            .toLowerCase()
            .includes(term)
        )
      : [...base];
  }

  /** ===== Paginação ===== */
  onPageSizeChange(n: number) {
    this.pageSize = +n || 20;
    this.currentPage = 1;
    this.view = [...this.view];
  }

  nextPage() {
    if (this.currentPage < this.totalPages) this.currentPage++;
  }

  prevPage() {
    if (this.currentPage > 1) this.currentPage--;
  }

  onPageSizeChangeG(n: number) {
    this.pageSizeG = +n || 20;
    this.currentPageG = 1;
    this.viewGrupos = [...this.viewGrupos];
  }

  nextPageG() {
    if (this.currentPageG < this.totalPagesG) this.currentPageG++;
  }

  prevPageG() {
    if (this.currentPageG > 1) this.currentPageG--;
  }
}
