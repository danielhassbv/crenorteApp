import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { db } from '../../firebase.config';
import {
  collection, onSnapshot, Unsubscribe,
  doc, setDoc
} from 'firebase/firestore';

type Papel =
  | 'admin' | 'supervisor' | 'coordenador' | 'assessor'
  | 'analista' | 'operacional' | 'rh' | 'financeiro' | 'qualidade';
type Status = 'ativo' | 'inativo';

export type Colaborador = {
  id: string;
  uid?: string;
  nome: string;
  email: string;
  papel: Papel;
  cargo?: string | null;
  status: Status;
  photoURL?: string | null;
  supervisorId?: string | null;
  analistaId?: string | null;
};

type Equipe = {
  id: string;               // `${supervisorId}__${analistaId || ''}`
  supervisorId: string;
  analistaId: string | null;
  nome: string;
};

type Bucket = {
  analista: Colaborador | null;
  assessores: Colaborador[];
  equipeId: string;
  equipeNome: string;
};

type GrupoSupervisor = {
  supervisor: Colaborador;
  buckets: Bucket[];        // agrupados por analista
  semAnalista: Colaborador[];
};

@Component({
  standalone: true,
  selector: 'app-hierarquia-colaboradores',
  imports: [CommonModule, FormsModule],
  templateUrl: './hierarquia-colaboradores.component.html',
  styleUrls: ['./hierarquia-colaboradores.component.css']
})
export class HierarquiaColaboradoresComponent implements OnInit, OnDestroy {
  private unsubColab?: Unsubscribe;
  private unsubEquipes?: Unsubscribe;

  // estado
  busca = '';
  loading = signal<boolean>(true);
  erro = signal<string | null>(null);

  // edição de nome de time (um por vez)
  editEquipeId: string | null = null;
  editEquipeNome = '';

  // dados
  private todos = signal<Colaborador[]>([]);
  private equipesMap = new Map<string, Equipe>();

  private grupos = signal<GrupoSupervisor[]>([]);
  private bucketsSemSupervisor = signal<Bucket[]>([]);

  // ===== Lifecycle =====
  ngOnInit(): void { this.subColaboradores(); this.subEquipes(); }
  ngOnDestroy(): void {
    this.unsubColab?.(); this.unsubEquipes?.();
  }

  // ===== Firestore =====
  private subColaboradores() {
    this.loading.set(true);
    this.unsubColab = onSnapshot(collection(db, 'colaboradores'), snap => {
      const rows: Colaborador[] = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .filter(r => (r.status ?? 'ativo') === 'ativo');

      this.todos.set(rows);
      this.montarArvore();
      this.loading.set(false);
    }, err => {
      console.error(err);
      this.erro.set('Falha ao carregar colaboradores.');
      this.loading.set(false);
    });
  }

  private subEquipes() {
    this.unsubEquipes = onSnapshot(collection(db, 'equipes'), snap => {
      this.equipesMap.clear();
      snap.forEach(d => {
        const e = { id: d.id, ...(d.data() as any) } as Equipe;
        this.equipesMap.set(e.id, e);
      });
      // aplicar nomes nos buckets
      this.montarArvore();
    }, err => console.error(err));
  }

  // ===== Montagem da árvore (SEM ROTAS) =====
  public montarArvore(): void {
    const rows = this.todos();

    const nrm = (s: string) =>
      (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const analistas = rows.filter(r => r.papel === 'analista')
      .sort((a,b) => nrm(a.nome).localeCompare(nrm(b.nome)));
    const mapAnalista = new Map(analistas.map(a => [a.id, a]));

    const supervisores = rows.filter(r => r.papel === 'supervisor')
      .sort((a,b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    // busca só filtra ASSESSORES (pra não sumir cabeçalhos)
    const assessoresBase = rows.filter(r => r.papel === 'assessor');
    const assessores = this.filtrarBusca(assessoresBase)
      .sort((a,b) => nrm(a.nome).localeCompare(nrm(b.nome)));

    // grupos por supervisor
    const grupos: GrupoSupervisor[] = supervisores.map(s => {
      const assDoSup = assessores.filter(a => (a.supervisorId ?? null) === s.id);

      // agrupar por analista
      const mapBuckets = new Map<string, Colaborador[]>();
      const semAnalista: Colaborador[] = [];
      for (const a of assDoSup) {
        const aid = a.analistaId ?? '';
        if (!aid) { semAnalista.push(a); continue; }
        if (!mapBuckets.has(aid)) mapBuckets.set(aid, []);
        mapBuckets.get(aid)!.push(a);
      }

      const buckets: Bucket[] = Array.from(mapBuckets.entries()).map(([aid, list]) => {
        const analista = mapAnalista.get(aid) ?? null;
        const equipeId = this.equipeId(s.id, aid);
        const equipeNome = this.equipesMap.get(equipeId)?.nome ?? '';
        return {
          analista,
          assessores: list.sort((x,y)=> nrm(x.nome).localeCompare(nrm(y.nome))),
          equipeId,
          equipeNome
        };
      }).sort((b1,b2)=> nrm(b1.analista?.nome || 'Sem analista').localeCompare(nrm(b2.analista?.nome || 'Sem analista')));

      return {
        supervisor: s,
        buckets,
        semAnalista: semAnalista.sort((x,y)=> nrm(x.nome).localeCompare(nrm(y.nome)))
      };
    });

    // assessores sem supervisor (global), agrupados por analista
    const assSemSup = assessores.filter(a => !a.supervisorId);
    const mapSemSup = new Map<string, Colaborador[]>();
    for (const a of assSemSup) {
      const aid = a.analistaId ?? '';
      if (!mapSemSup.has(aid)) mapSemSup.set(aid, []);
      mapSemSup.get(aid)!.push(a);
    }
    const semSupervisor: Bucket[] = Array.from(mapSemSup.entries()).map(([aid, list]) => {
      const analista = aid ? (mapAnalista.get(aid) ?? null) : null;
      return {
        analista,
        assessores: list.sort((x,y)=> nrm(x.nome).localeCompare(nrm(y.nome))),
        equipeId: this.equipeId('', aid),     // não editamos esses
        equipeNome: ''
      };
    }).sort((b1,b2)=> nrm(b1.analista?.nome || 'Sem analista').localeCompare(nrm(b2.analista?.nome || 'Sem analista')));

    this.grupos.set(grupos);
    this.bucketsSemSupervisor.set(semSupervisor);
  }

  // ===== Compat/Selectors pro template =====
  public porSupervisor(): GrupoSupervisor[] { return this.grupos(); }
  public semSupervisor(): Bucket[] { return this.bucketsSemSupervisor(); }

  public totalAssessoresDoGrupo(g: GrupoSupervisor): number {
    let tot = g.semAnalista.length;
    for (const b of g.buckets) tot += b.assessores.length;
    return tot;
  }
  public totalAssessoresSemSup(): number {
    let tot = 0;
    for (const b of this.bucketsSemSupervisor()) tot += b.assessores.length;
    return tot;
  }

  // ===== Nome do time (equipe) =====
  private equipeId(supervisorId: string, analistaId: string): string {
    return `${supervisorId || 'nosup'}__${analistaId || ''}`;
  }

  public startEditEquipe(b: Bucket, supId: string) {
    this.editEquipeId = b.equipeId;
    this.editEquipeNome = b.equipeNome || '';
  }
  public cancelEditEquipe() {
    this.editEquipeId = null;
    this.editEquipeNome = '';
  }
  public async salvarEquipeNome(b: Bucket, supId: string) {
    const nome = (this.editEquipeNome || '').trim();
    const [supervisorId, analistaIdRaw] = b.equipeId.split('__');
    const analistaId = analistaIdRaw || null;

    try {
      await setDoc(doc(db, 'equipes', b.equipeId), {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      }, { merge: true });

      // refletir na UI imediatamente
      this.equipesMap.set(b.equipeId, {
        id: b.equipeId,
        supervisorId: supervisorId === 'nosup' ? '' : supervisorId,
        analistaId,
        nome
      });
      this.montarArvore();
      this.cancelEditEquipe();
    } catch (e) {
      console.error(e);
      this.erro.set('Falha ao salvar o nome do time.');
    }
  }

  // ===== Helpers =====
  private filtrarBusca(items: Colaborador[]): Colaborador[] {
    const term = (this.busca || '').trim().toLowerCase();
    if (!term) return items;
    return items.filter(c => {
      const blob = `${c.nome} ${c.email}`.toLowerCase();
      return blob.includes(term);
    });
  }
  public inicial(nome: string) { return (nome?.trim()?.[0] || '?').toUpperCase(); }
}
