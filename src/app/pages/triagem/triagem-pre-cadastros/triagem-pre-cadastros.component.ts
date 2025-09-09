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

  // path e flags auxiliares
  _path: string;
  _eDeAssessor?: boolean;

  // “quem criou” (assessor designado)
  createdByUid?: string | null;
  createdByNome?: string | null;
};

type Assessor = {
  uid: string;
  nome?: string;
  email?: string;
  status?: string;
  papel?: string;
  rota?: string; // exibido em parênteses no seletor
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

  // assessores / designação
  assessores: Assessor[] = [];
  selecaoAssessor: Record<string, string> = {}; // por id => uid do assessor
  designando: Record<string, boolean> = {};
  okDesignado: Record<string, boolean> = {};
  errDesignado: Record<string, boolean> = {};

  async ngOnInit(): Promise<void> {
    await this.carregarAssessores();
    this.carregarTodos();
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  // ---------- Firestore: carregar TODOS (sem orderBy para não exigir índice) ----------
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

            // quem “criou” (assessor designado)
            createdByUid: data?.createdByUid ?? null,
            createdByNome: data?.createdByNome ?? null,
          };
        });

        // ordena por data desc no cliente
        rows.sort((a, b) => (b.data?.getTime() || 0) - (a.data?.getTime() || 0));

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

  // ---------- Firestore: carregar assessores ativos (assessor/admin) ----------
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
        .sort((a, b) =>
          (a.nome ?? a.email ?? '').localeCompare(b.nome ?? b.email ?? '')
        );
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

  initial(s: string): string {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() : '?';
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
    const term = (this.busca || '').toLowerCase();
    const rota = (this.filtroRota || '').toLowerCase();

    if (rota) {
      list = list.filter((p) => (p.rota || '').toLowerCase().includes(rota));
    }
    if (term) {
      list = list.filter((p) => {
        const blob = `${p.nome} ${p.cpf} ${p.telefone} ${p.email} ${p.endereco} ${p.bairro} ${p.rota} ${p.origem}`.toLowerCase();
        return blob.includes(term);
      });
    }

    if (this.somenteNaoDesignados) {
      list = list.filter(
        (p) => !(p.createdByUid && String(p.createdByUid).trim()) && !p._eDeAssessor
      );
    }

    this.view = list;
  }

  // ========== ação: designar para assessor (como “quem criou”) ==========
  async designarParaAssessor(r: PreCadastroRow) {
    const uid = this.selecaoAssessor[r.id];
    if (!uid) return;

    this.designando[r.id] = true;
    this.okDesignado[r.id] = false;
    this.errDesignado[r.id] = false;

    try {
      // 1) buscar dados do colaborador escolhido
      const colabRef = doc(db, 'colaboradores', uid);
      const colabSnap = await getDoc(colabRef);
      if (!colabSnap.exists()) throw new Error('Colaborador (assessor) não encontrado.');

      const colab = colabSnap.data() as any;
      const assessorNome = colab?.nome ?? colab?.displayName ?? null;

      // 2) atualizar o documento original com “quem criou”
      const srcRef = doc(db, r._path);
      const patch = {
        createdByUid: uid,
        createdByNome: assessorNome,
        // metadados úteis
        designadoEm: serverTimestamp(),
        designadoPara: uid, // opcional manter
      };
      await setDoc(srcRef, patch, { merge: true });

      // 3) feedback visual imediato
      const idx = this.all.findIndex((x) => x.id === r.id && x._path === r._path);
      if (idx >= 0) {
        this.all[idx] = {
          ...this.all[idx],
          createdByUid: uid,
          createdByNome: assessorNome,
        };
        this.aplicarFiltros();
      }

      this.okDesignado[r.id] = true;
    } catch (e) {
      console.error('[Triagem] designarParaAssessor erro:', e);
      this.errDesignado[r.id] = true;
      alert('Não foi possível designar. Verifique as regras e tente novamente.');
    } finally {
      this.designando[r.id] = false;
    }
  }
}
