import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { HeaderComponent } from '../shared/header/header.component';

import { db } from '../../firebase.config';
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
  limit,
} from 'firebase/firestore';

import { getAuth, User } from 'firebase/auth';

/* =========================
   Normalização & Origens
   ========================= */
function normalizeBasic(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s: string): string {
  return (s || '').toLowerCase().replace(/(^|\s)\S/g, (t) => t.toUpperCase());
}

const ORIGEM_SYNONYMS: Record<string, string> = {
  panfleto: 'panfleto',
  panfletos: 'panfleto',
  online: 'online',
  'on-line': 'online',
  site: 'online',
  formulario: 'online',
  formulário: 'online',
  telefone: 'telefone',
  tel: 'telefone',
  celular: 'telefone',
  cel: 'telefone',
  whatsapp: 'whatsapp',
  wpp: 'whatsapp',
  zap: 'whatsapp',
  wtz: 'whatsapp',
  whats: 'whatsapp',
  igreja: 'igreja',
  presencial: 'presencial',
  visita: 'presencial',
  'visita presencial': 'presencial',
  'cadastro presencial': 'presencial',
  indicacao: 'indicacao',
  indicação: 'indicacao',
  proprio: 'proprio',
  próprio: 'proprio',
  própria: 'proprio',
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

type StatusAprovacao = 'nao' | 'apto' | 'inapto';

function coerceStatusToUi(x: any): StatusAprovacao {
  const n = normalizeBasic(String(x || ''));
  if (n.startsWith('apto')) return 'apto';
  if (n.startsWith('ina')) return 'inapto';
  return 'nao';
}

function canonicalizeOrigem(raw: string): { key: string; label: string } {
  const n = normalizeBasic(raw);

  if (n in ORIGEM_SYNONYMS) {
    const key = ORIGEM_SYNONYMS[n];
    return {
      key,
      label: ORIGEM_LABELS[key as keyof typeof ORIGEM_LABELS] || titleCase(key),
    };
  }
  if (/whats|zap|wpp/.test(n))
    return { key: 'whatsapp', label: ORIGEM_LABELS['whatsapp'] };
  if (/on\s?-?\s?line|site|formul/.test(n))
    return { key: 'online', label: ORIGEM_LABELS['online'] };
  if (/telefone|tel|cel/.test(n))
    return { key: 'telefone', label: ORIGEM_LABELS['telefone'] };
  if (/igreja/.test(n))
    return { key: 'igreja', label: ORIGEM_LABELS['igreja'] };
  if (/presencial|visita/.test(n))
    return { key: 'presencial', label: ORIGEM_LABELS['presencial'] };
  if (/indic/.test(n))
    return { key: 'indicacao', label: ORIGEM_LABELS['indicacao'] };
  if (/propri/.test(n))
    return { key: 'proprio', label: ORIGEM_LABELS['proprio'] };

  if (n) return { key: n, label: titleCase(raw) };
  return { key: 'outros', label: ORIGEM_LABELS['outros'] };
}

/* =========================
   Tipos
   ========================= */
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
  rota?: string;
  status?: 'ativo' | 'inativo';
  supervisorId?: string | null;
  analistaId?: string | null;
}

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

  encaminhadoParaUid?: string | null;
  encaminhadoParaNome?: string | null;
  encaminhadoEm?: Date | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;

  caixaAtual?: string | null;
  caixaUid?: string | null;

  _path: string;
  _eDeAssessor?: boolean;

  createdByUid?: string | null;
  createdByNome?: string | null;
};

export type StatusGrupo = 'em_qa' | 'aprovado_basa' | 'reprovado_basa';

type GrupoRow = {
  id: string;
  codigo?: string;
  coordenadorCpf?: string;
  coordenadorNome?: string;

  membrosIds: string[];

  bairro?: string;
  cidade?: string;
  estado?: string;
  status: StatusGrupo;

  criadoEm: Date | null;
  criadoPorUid?: string | null;
  criadoPorNome?: string | null;
  totalSolicitado?: number;
  observacoes?: string;

  designadoEm?: Date | null;
  designadoParaUid?: string | null;
  designadoParaNome?: string | null;

  encaminhadoParaUid?: string | null;
  encaminhadoParaNome?: string | null;
  encaminhadoEm?: Date | null;
  encaminhadoPorUid?: string | null;
  encaminhadoPorNome?: string | null;

  caixaAtual?: string | null;
  caixaUid?: string | null;
};

type Assessor = {
  uid: string;
  nome?: string;
  email?: string;
  status?: string;
  papel?: string;
  rota?: string;
};

/* =========================
   Componente
   ========================= */
@Component({
  standalone: true,
  selector: 'app-triagem-supervisao',
  imports: [CommonModule, FormsModule, HeaderComponent],
  templateUrl: './triagem-supervisao.component.html',
  styleUrls: ['./triagem-supervisao.component.css'],
})
export class TriagemSupervisaoComponent implements OnInit, OnDestroy {
  carregando = signal(false);
  erro = signal<string | null>(null);

  // Quem está logado
  me: { uid: string; papel: Papel; nome: string } | null = null;

  // abas
  activeTab: 'pessoas' | 'grupos' = 'pessoas';
  setTab(tab: 'pessoas' | 'grupos') {
    this.activeTab = tab;
    this.onBusca(this.busca);
  }

  // busca & filtros (PESSOAS)
  busca = '';
  envioFilter: 'todos' | 'encaminhado' | 'nao_encaminhado' = 'todos';
  statusFilter: 'todos' | StatusAprovacao = 'todos';

  setEnvio(k: 'todos' | 'encaminhado' | 'nao_encaminhado') {
    this.envioFilter = this.envioFilter === k ? 'todos' : k;
    this.aplicarFiltrosPessoas();
  }
  setStatus(k: 'todos' | StatusAprovacao) {
    this.statusFilter = this.statusFilter === k ? 'todos' : k;
    this.aplicarFiltrosPessoas();
  }

  // ===== Dados PESSOAS =====
  private unsubPC?: Unsubscribe;
  private pcById = new Map<string, PreCadastroRow>();
  private basePessoas: PreCadastroRow[] = []; // somente o que está na "minha" caixa
  all: PreCadastroRow[] = []; // base + membros de grupos
  view: PreCadastroRow[] = [];

  // paginação PESSOAS
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
    return Math.min(
      this.pageStart + this.pageSize,
      this.pageSize * this.currentPage
    );
  }
  get pageItems() {
    return this.view.slice(this.pageStart, this.pageEnd);
  }

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

  // ===== Dados GRUPOS =====
  private unsubGrupos?: Unsubscribe;
  allGrupos: GrupoRow[] = [];
  viewGrupos: GrupoRow[] = [];

  // paginação GRUPOS
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
    return Math.min(
      this.pageStartG + this.pageSizeG,
      this.pageSizeG * this.currentPageG
    );
  }
  get pageItemsG() {
    return this.viewGrupos.slice(this.pageStartG, this.pageEndG);
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

  // ===== Assessores =====
  assessores: Assessor[] = [];
  assessoresFiltrados: Assessor[] = [];
  assessoresFiltradosGrupo: Assessor[] = [];

  // Modal Pessoas
  showAssessorModal = false;
  rowSelecionado: PreCadastroRow | null = null;
  selectedAssessorUid: string | null = null;
  assessorBusca = '';

  // Modal Grupo
  showAssessorModalGrupo = false;
  grupoSelecionado: GrupoRow | null = null;
  selectedAssessorUidGrupo: string | null = null;
  assessorBuscaGrupo = '';

  // Detalhe Grupo
  showGrupoDetalhe = false;
  membrosPC: PreCadastroRow[] = [];

  // flags de carregamento duplo (pessoas + grupos)
  private pcLoaded = false;
  private gruposLoaded = false;

  /* =========================
     Ciclo de vida
     ========================= */
  async ngOnInit(): Promise<void> {
    this.carregando.set(true);
    await this.initMeAndBootstrap();
  }

  ngOnDestroy(): void {
    this.unsubPC?.();
    this.unsubGrupos?.();
  }

  private async initMeAndBootstrap() {
    try {
      // Descobre "me"
      const auth = getAuth();
      const authUser: User | null = auth.currentUser;

      if (authUser?.uid) {
        const meSnap = await getDoc(doc(db, 'colaboradores', authUser.uid));
        if (meSnap.exists()) {
          const x = meSnap.data() as any;
          this.me = {
            uid: authUser.uid,
            papel: (x?.papel as Papel) || 'supervisor',
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
        const lsPapel =
          (localStorage.getItem('mePapel') as Papel) || 'supervisor';
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
      this.carregarPreCadastros();
      this.carregarGrupos();
    } catch (e) {
      console.error('[Triagem-supervisao] falha ao inicializar:', e);
      this.erro.set('Falha ao inicializar a central de triagem.');
      this.carregando.set(false);
    }
  }

  private checkLoaded() {
    if (this.pcLoaded && this.gruposLoaded) {
      this.carregando.set(false);
    }
  }

  /* =========================
     Assessores (meu time)
     ========================= */
  private async carregarAssessoresDoMeuTime(): Promise<void> {
    try {
      const meUid = this.me?.uid || null;
      if (!meUid) {
        this.assessores = [];
        this.assessoresFiltrados = [];
        this.assessoresFiltradosGrupo = [];
        return;
      }

      const col = collection(db, 'colaboradores');

      const qSup = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', '==', 'assessor'),
        where('supervisorId', '==', meUid)
      );
      const supSnap = await getDocs(qSup);

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
      console.error('[Triagem] Falha ao carregar assessores do meu time:', e);
      this.assessores = [];
      this.assessoresFiltrados = [];
      this.assessoresFiltradosGrupo = [];
    }
  }

  /* =========================
     Helpers gerais
     ========================= */
  private toDate(x: unknown): Date | null {
    if (!x) return null;
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }

  private normalize(s: string): string {
    return normalizeBasic(s);
  }

  cpfMask(val?: string | null): string {
    const d = String(val ?? '').replace(/\D+/g, '');
    if (d.length !== 11) return val ?? '';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

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

  trackById(_i: number, r: { id?: string } | null): string | undefined {
    return r?.id;
  }

  trackByGrupoId(_i: number, g: { id?: string } | null): string | undefined {
    return g?.id;
  }

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

  /* =========================
     Snapshot de PRÉ-CADASTROS
     ========================= */
  private carregarPreCadastros(): void {
    this.unsubPC?.();

    const base = collectionGroup(db, 'pre_cadastros');
    const qy = query(base, limit(1500)); // limite de segurança

    this.unsubPC = onSnapshot(
      qy,
      (snap) => {
        try {
          const rows: PreCadastroRow[] = snap.docs.map((d) => {
            const data = d.data() as any;
            const path = d.ref.path;

            const origemRaw = String(data?.origem ?? '').trim();
            const canon = canonicalizeOrigem(origemRaw);

            // status UI igual TriagemPreCadastros
            let uiStatus: StatusAprovacao = 'nao';
            if (data?.aprovacao?.status) {
              const novo = String(data.aprovacao.status);
              const n = normalizeBasic(novo);
              uiStatus = n === 'apto' ? 'apto' : n === 'inapto' ? 'inapto' : 'nao';
            } else {
              uiStatus = coerceStatusToUi(data?.statusAprovacao);
            }

            const designadoParaUid: string | null =
              (data?.designadoParaUid ?? data?.designadoPara ?? null) || null;
            const designadoParaNome: string | null =
              data?.designadoParaNome ?? null;

            return {
              id: d.id,
              data: this.toDate(data?.createdAt ?? data?.criadoEm),

              nome: String(data?.nomeCompleto ?? data?.nome ?? '').trim(),
              cpf: String(data?.cpf ?? '').trim(),
              telefone: String(data?.telefone ?? data?.contato ?? '').trim(),
              email: String(data?.email ?? '').trim(),
              endereco: String(
                data?.endereco ?? data?.enderecoCompleto ?? ''
              ).trim(),
              bairro: String(data?.bairro ?? '').trim(),
              rota: String(data?.rota ?? '').trim(),
              cidade: String(data?.cidade ?? '').trim(),
              uf: String(data?.uf ?? data?.estado ?? '').trim(),

              origem: canon.label,
              origemKey: canon.key,
              origemLabel: canon.label,

              statusAprovacao: uiStatus,

              designadoEm: this.toDate(data?.designadoEm) ?? null,
              designadoParaUid,
              designadoParaNome,

              encaminhadoParaUid: data?.encaminhadoParaUid ?? null,
              encaminhadoParaNome: data?.encaminhadoParaNome ?? null,
              encaminhadoEm: this.toDate(data?.encaminhadoEm) ?? null,
              encaminhadoPorUid: data?.encaminhadoPorUid ?? null,
              encaminhadoPorNome: data?.encaminhadoPorNome ?? null,

              caixaAtual: data?.caixaAtual ?? null,
              caixaUid: data?.caixaUid ?? null,

              _path: path,
              _eDeAssessor: path.startsWith('colaboradores/'),

              createdByUid: data?.createdByUid ?? null,
              createdByNome: data?.createdByNome ?? null,
            };
          });

          // índice global por ID, usado pelos grupos
          this.pcById.clear();
          for (const r of rows) {
            this.pcById.set(String(r.id), r);
          }

          const meUid = this.me?.uid || null;

          // basePessoas = só o que está na minha caixa OU que eu encaminhei
          const baseList = rows
            .filter((r) => {
              if (!meUid) return false;
              const emMinhaCaixa = r.caixaUid === meUid;
              const encaminhadoPorMim = r.encaminhadoPorUid === meUid;
              return emMinhaCaixa || encaminhadoPorMim;
            })
            .sort(
              (a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0)
            );

          this.basePessoas = baseList;

          // all = base + membros dos grupos (via membrosIds)
          this.all = this.mergePessoasComGrupos(this.basePessoas);
          this.aplicarFiltrosPessoas();

          this.pcLoaded = true;
          this.checkLoaded();
        } catch (e) {
          console.error('[Triagem] Falha ao processar pré-cadastros:', e);
          this.erro.set('Falha ao processar pré-cadastros.');
          this.carregando.set(false);
        }
      },
      (err) => {
        console.error('[Triagem] onSnapshot pré-cadastros error:', err);
        this.erro.set(
          err?.message ?? 'Falha ao carregar pré-cadastros da triagem.'
        );
        this.carregando.set(false);
      }
    );
  }

  /* =========================
     Snapshot de GRUPOS
     ========================= */
  private carregarGrupos(): void {
    this.unsubGrupos?.();

    const colRef = collection(db, 'grupos_solidarios');
    const qy = query(colRef, orderBy('criadoEm', 'desc'));

    this.unsubGrupos = onSnapshot(
      qy,
      (snap) => {
        try {
          const arr: GrupoRow[] = snap.docs.map((d) => {
            const x = d.data() as any;

            // suporte a legado: se não houver membrosIds, tenta extrair de membros[].cadastroId
            const ids: string[] = Array.isArray(x.membrosIds)
              ? x.membrosIds
              : Array.isArray(x.membros)
              ? x.membros
                  .map((m: any) => m?.cadastroId)
                  .filter((v: any) => !!v)
              : [];

            return {
              id: d.id,
              codigo: x.codigo,
              coordenadorCpf: x.coordenadorCpf,
              coordenadorNome: x.coordenadorNome,

              membrosIds: ids,

              bairro: x.bairro || '',
              cidade: x.cidade || '',
              estado: x.estado || x.uf || '',
              status: (x.status || 'em_qa') as StatusGrupo,
              criadoEm: x.criadoEm?.toDate?.() || null,
              criadoPorUid: x.criadoPorUid ?? null,
              criadoPorNome: x.criadoPorNome ?? null,
              totalSolicitado: x.totalSolicitado || 0,
              observacoes: x.observacoes || '',

              designadoEm: x.designadoEm?.toDate?.() || null,
              designadoParaUid: x.designadoParaUid || null,
              designadoParaNome: x.designadoParaNome || null,

              encaminhadoParaUid: x.encaminhadoParaUid ?? null,
              encaminhadoParaNome: x.encaminhadoParaNome ?? null,
              encaminhadoEm: x.encaminhadoEm?.toDate?.() || null,
              encaminhadoPorUid: x.encaminhadoPorUid ?? null,
              encaminhadoPorNome: x.encaminhadoPorNome ?? null,

              caixaAtual: x.caixaAtual ?? null,
              caixaUid: x.caixaUid ?? null,
            };
          });

          // Filtra para mostrar só grupos relacionados ao "me"
          const meUid = this.me?.uid || null;
          let list = arr;
          if (meUid) {
            list = arr.filter((g) => {
              const emMinhaCaixa = g.caixaUid === meUid;
              const encaminhadoPorMim = g.encaminhadoPorUid === meUid;
              return emMinhaCaixa || encaminhadoPorMim;
            });
          } else {
            list = [];
          }

          list.sort(
            (a, b) =>
              (b.criadoEm?.getTime?.() || 0) - (a.criadoEm?.getTime?.() || 0)
          );

          this.allGrupos = list;
          this.filtrarGrupos();

          // Re-monta all (pessoas + membros dos grupos)
          this.all = this.mergePessoasComGrupos(this.basePessoas);
          this.aplicarFiltrosPessoas();

          this.gruposLoaded = true;
          this.checkLoaded();
        } catch (e) {
          console.error('[Triagem] Falha ao processar grupos:', e);
          this.erro.set('Falha ao processar grupos.');
          this.carregando.set(false);
        }
      },
      (err) => {
        console.error('[Triagem] Snapshot grupos error:', err);
        this.erro.set(err?.message ?? 'Falha ao carregar grupos.');
        this.carregando.set(false);
      }
    );
  }

  /* =========================
     Merge Pessoas + Membros de Grupos
     ========================= */
  private getPCById(id?: string | null): PreCadastroRow | null {
    if (!id) return null;
    return this.pcById.get(String(id)) || null;
  }

  private montarMembrosPorIds(g: GrupoRow): PreCadastroRow[] {
    const ids = g.membrosIds || [];
    const itens: PreCadastroRow[] = [];
    for (const id of ids) {
      const pc = this.getPCById(id);
      if (pc) itens.push(pc);
    }
    return itens;
  }

  private mergePessoasComGrupos(baseList: PreCadastroRow[]): PreCadastroRow[] {
    const result = [...baseList];
    const indexById = new Map<string, number>();

    result.forEach((p, idx) => {
      if (p.id) indexById.set(p.id, idx);
    });

    const meUid = this.me?.uid || null;

    const gruposRelevantes = this.allGrupos.filter((g) => {
      if (!meUid) return false;
      const emMinhaCaixa = g.caixaUid === meUid;
      const encaminhadoPorMim = g.encaminhadoPorUid === meUid;
      return emMinhaCaixa || encaminhadoPorMim;
    });

    for (const g of gruposRelevantes) {
      const membros = this.montarMembrosPorIds(g);
      for (const pc of membros) {
        if (!pc?.id) continue;

        const idx = indexById.get(pc.id);
        if (idx != null) {
          // se já existe na lista, posso só garantir que a "caixa" não fique vazia
          const current = result[idx];
          const merged: PreCadastroRow = {
            ...current,
            caixaAtual: current.caixaAtual ?? g.caixaAtual ?? null,
            caixaUid: current.caixaUid ?? g.caixaUid ?? null,
          };
          result[idx] = merged;
        } else {
          const clone: PreCadastroRow = {
            ...pc,
            caixaAtual: pc.caixaAtual ?? g.caixaAtual ?? null,
            caixaUid: pc.caixaUid ?? g.caixaUid ?? null,
          };
          indexById.set(clone.id, result.length);
          result.push(clone);
        }
      }
    }

    result.sort(
      (a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0)
    );
    return result;
  }

  /* =========================
     Filtros PESSOAS
     ========================= */
  onBusca(v: string) {
    this.busca = (v ?? '').trim();
    if (this.activeTab === 'pessoas') this.aplicarFiltrosPessoas();
    else this.filtrarGrupos();
  }

  aplicarFiltrosPessoas() {
    let list = [...this.all];

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

    const term = this.normalize(this.busca);
    if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.cidade} ${p.uf} ${p.origemLabel}`
        );
        return blob.includes(term);
      });
    }

    list.sort(
      (a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0)
    );
    this.view = list;
    this.currentPage = 1;
  }

  /* =========================
     Filtros GRUPOS
     ========================= */
  filtrarGrupos() {
    let list = [...this.allGrupos];
    const term = this.normalize(this.busca);

    if (term) {
      list = list.filter((g) => {
        const blob = this.normalize(
          `${g.codigo || ''} ${g.coordenadorNome || ''} ${g.bairro || ''} ${g.cidade || ''} ${g.estado || ''}`
        );
        return blob.includes(term);
      });
    }

    this.viewGrupos = list;
    this.currentPageG = 1;
  }

  /* =========================
     MODAL Pessoas – Escolher Assessor
     ========================= */
  abrirModalAssessor(row: PreCadastroRow) {
    this.rowSelecionado = row;
    this.selectedAssessorUid = row.encaminhadoParaUid || row.designadoParaUid || null;
    this.assessorBusca = '';
    this.assessoresFiltrados = [...this.assessores];
    this.showAssessorModal = true;
  }

  fecharModalAssessor() {
    this.showAssessorModal = false;
    this.rowSelecionado = null;
    this.selectedAssessorUid = null;
  }

  /* =========================
     MODAL Grupo – Escolher Assessor
     ========================= */
  abrirModalAssessorGrupo(g: GrupoRow) {
    this.grupoSelecionado = g;
    this.selectedAssessorUidGrupo =
      g.encaminhadoParaUid || g.designadoParaUid || null;
    this.assessorBuscaGrupo = '';
    this.assessoresFiltradosGrupo = [...this.assessores];
    this.showAssessorModalGrupo = true;
  }

  fecharModalAssessorGrupo() {
    this.showAssessorModalGrupo = false;
    this.grupoSelecionado = null;
    this.selectedAssessorUidGrupo = null;
  }

  /* =========================
     Detalhe Grupo – membrosPC
     ========================= */
  abrirDetalheGrupo(g: GrupoRow) {
    this.grupoSelecionado = g;
    this.membrosPC = this.montarMembrosPorIds(g);
    this.showGrupoDetalhe = true;
  }

  fecharDetalheGrupo() {
    this.showGrupoDetalhe = false;
    this.grupoSelecionado = null;
    this.membrosPC = [];
  }

  /* =========================
     Designar / Encaminhar PESSOA
     ========================= */
  async designarParaAssessor(
    r: PreCadastroRow,
    uid?: string | null
  ): Promise<void> {
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

      // Atualiza local
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

      this.all = this.all.map((x) => (x.id === r.id ? { ...x, ...patch } : x));
      this.view = this.view.map((x) => (x.id === r.id ? { ...x, ...patch } : x));
      this.pcById.set(r.id, { ...(this.pcById.get(r.id) || r), ...patch });

      this.aplicarFiltrosPessoas();
    } catch (e) {
      console.error('[Triagem] Falha ao designar pessoa:', e);
      alert('Não foi possível encaminhar. Tente novamente.');
    }
  }

  /* =========================
     Designar / Encaminhar GRUPO
     ========================= */
  async designarGrupo(g: GrupoRow, uid?: string | null): Promise<void> {
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

      const batch = writeBatch(db);

      // grupo
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

      // membros (pré-cadastros)
      const ids = g.membrosIds || [];
      for (const id of ids) {
        const pc = this.getPCById(id);
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

      await batch.commit();

      // Atualiza localmente grupo
      const patchGrupo: Partial<GrupoRow> = {
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

      this.allGrupos = this.allGrupos.map((x) =>
        x.id === g.id ? { ...x, ...patchGrupo } : x
      );
      this.viewGrupos = this.viewGrupos.map((x) =>
        x.id === g.id ? { ...x, ...patchGrupo } : x
      );

      // Atualiza localmente os pré-cadastros (pessoas)
      const now = new Date();
      const patchPC: Partial<PreCadastroRow> = {
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

      const idSet = new Set(g.membrosIds || []);

      this.all = this.all.map((pc) =>
        idSet.has(pc.id) ? { ...pc, ...patchPC } : pc
      );
      this.view = this.view.map((pc) =>
        idSet.has(pc.id) ? { ...pc, ...patchPC } : pc
      );

      for (const id of idSet) {
        const old = this.pcById.get(id);
        if (old) this.pcById.set(id, { ...old, ...patchPC });
      }

      // Recalcula merge para garantir consistência
      this.all = this.mergePessoasComGrupos(this.basePessoas);
      this.aplicarFiltrosPessoas();
      this.filtrarGrupos();
    } catch (e) {
      console.error('[Triagem] Falha ao designar grupo:', e);
      alert('Não foi possível encaminhar o grupo. Tente novamente.');
    }
  }
}
