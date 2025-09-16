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
  origem: string;

  _path: string;
  _eDeAssessor?: boolean;

  // já designado/enviado
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

  // filtros
  busca = '';
  filtroRota = '';
  somenteNaoDesignados = false;

  // dados
  private unsub?: Unsubscribe;
  all: PreCadastroRow[] = [];
  view: PreCadastroRow[] = [];

  // assessores / designação (sem select)
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
    await this.carregarAssessores();
    this.carregarTodos();
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  // ---------- carregar pré-cadastros ----------
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
            origem: String(data?.origem ?? '').trim(),
            _path: path,
            _eDeAssessor: path.startsWith('colaboradores/'),

            createdByUid: data?.createdByUid ?? null,
            createdByNome: data?.createdByNome ?? null,
          };
        });

        // ordena por data desc no cliente
        rows.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

        // pré-preenche a seleção para linhas já enviadas
        rows.forEach((r) => {
          if (r.createdByUid) {
            this.selecaoAssessor[r.id] = r.createdByUid!;
            this.selecaoAssessorNome[r.id] = r.createdByNome || this.resolveAssessorNome(r.createdByUid!);
          }
        });

        this.all = rows;
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

  // ---------- carregar assessores ----------
  private async carregarAssessores() {
    try {
      const col = collection(db, 'colaboradores');
      const q1 = query(
        col,
        where('status', '==', 'ativo'),
        where('papel', 'in', ['assessor', 'admin'])
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

  // ---------- utils ----------
  private toDate(x: unknown): Date | null {
    if (!x) return null;
    if (typeof (x as any)?.toDate === 'function') return (x as any).toDate();
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    return null;
  }

  private normalize(s: string): string {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  initial(s: string): string {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() : '?';
  }

  nomeAssessor(a: Assessor): string {
    return (a?.nome || a?.email || a?.uid || '').toString();
  }

  resolveAssessorNome(uid: string): string {
    const a = this.assessores.find((x) => x.uid === uid);
    return this.nomeAssessor(a as Assessor) || uid;
  }

  isEnviado(r: PreCadastroRow): boolean {
    return !!(r.createdByUid && String(r.createdByUid).trim());
  }

  actionLabel(r: PreCadastroRow): string {
    return this.isEnviado(r) ? 'Atualizar' : 'Enviar';
  }

  isEnviarDisabled(r: PreCadastroRow): boolean {
    const sel = this.selecaoAssessor[r.id];
    if (!sel) return true;
    if (this.designando[r.id]) return true;
    // se já enviado e não mudou o assessor, não habilita
    if (this.isEnviado(r) && sel === r.createdByUid) return true;
    return false;
  }

  // ---------- filtros ----------
  onBusca(val: string) {
    this.busca = (val ?? '').trim();
    this.aplicarFiltros();
  }
  onFiltroRota(val: string) {
    this.filtroRota = (val ?? '').trim();
    this.aplicarFiltros();
  }
  limparFiltros() {
    this.busca = '';
    this.filtroRota = '';
    this.somenteNaoDesignados = false;
    this.aplicarFiltros();
  }

  aplicarFiltros() {
    let list = [...this.all];
    const term = this.normalize(this.busca);
    const rota = this.normalize(this.filtroRota);

    if (rota) list = list.filter((p) => this.normalize(p.rota).includes(rota));
    if (term) {
      list = list.filter((p) => {
        const blob = this.normalize(
          `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.origem}`
        );
        return blob.includes(term);
      });
    }
    if (this.somenteNaoDesignados) {
      list = list.filter((p) => !this.isEnviado(p) && !p._eDeAssessor);
    }

    this.view = list;
  }

  // ========== enviar/atualizar ==========
  async designarParaAssessor(r: PreCadastroRow) {
    const uid = this.selecaoAssessor[r.id];
    if (!uid) return;

    this.designando[r.id] = true;
    this.errDesignado[r.id] = false;

    try {
      // 1) dados do colaborador
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador (assessor) não encontrado.');

      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      // 2) patch no doc de origem
      const srcRef = doc(db, r._path);
      const patch = {
        createdByUid: uid,
        createdByNome: assessorNome,
        designadoEm: serverTimestamp(),
        designadoPara: uid,
      };
      await setDoc(srcRef, patch, { merge: true });

      // 3) feedback visual
      const idx = this.all.findIndex((x) => x.id === r.id && x._path === r._path);
      if (idx >= 0) {
        this.all[idx] = { ...this.all[idx], createdByUid: uid, createdByNome: assessorNome };
        // atualiza o nome exibido na pílula
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

  // ===== Modal =====
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
