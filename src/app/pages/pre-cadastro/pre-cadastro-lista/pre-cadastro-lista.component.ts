import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router'; // ⬅️ ADICIONE Router AQUI
import { FormsModule } from '@angular/forms';
import { NgxMaskDirective, provideNgxMask } from 'ngx-mask';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { Auth, user } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { PreCadastro } from '../../../models/pre-cadastro.model';

type PreCadastroEdit = PreCadastro & { id: string };

@Component({
  selector: 'app-pre-cadastro-lista',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe, FormsModule, NgxMaskDirective],
  providers: [provideNgxMask()],
  templateUrl: './pre-cadastro-lista.component.html',
  styleUrls: ['./pre-cadastro-lista.component.css']
})
export class PreCadastroListaComponent implements OnInit, OnDestroy {
  private service = inject(PreCadastroService);
  private auth = inject(Auth);
  private router = inject(Router); // ⬅️ INJEÇÃO DO ROUTER

  loading = signal(true);
  itens = signal<PreCadastro[]>([]);
  private sub?: Subscription;

  // estado dos modais
  modalVerAberto = signal(false);
  modalEditarAberto = signal(false);
  viewItem = signal<PreCadastro | null>(null);
  editModel = signal<PreCadastroEdit | null>(null);
  saving = signal(false);

  ngOnInit(): void {
    this.sub = user(this.auth).subscribe(async u => {
      this.loading.set(true);
      try {
        if (!u) { this.itens.set([]); return; }
        const rows = await this.service.listarDoAssessor(u.uid);
        this.itens.set(rows);
      } catch (err) {
        console.error('[PreCadastro] Erro ao listar:', err);
        this.itens.set([]);
      } finally {
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  // util para limpar máscara/pontuação
  private onlyDigits(v?: string | null): string {
    return (v ?? '').replace(/\D+/g, '');
  }

  abrirVer(i: PreCadastro) {
    this.viewItem.set(i);
    this.modalVerAberto.set(true);
  }

  abrirEditar(i: PreCadastro) {
    if (!i?.id) { console.warn('Item sem ID para edição'); return; }
    this.editModel.set({
      ...(i as any),
      id: i.id,
      cpf: this.onlyDigits(i.cpf as any),
      telefone: this.onlyDigits(i.telefone as any),
      email: (i.email ?? '').trim(),
      nomeCompleto: (i.nomeCompleto ?? '').trim(),
      bairro: i.bairro ?? '',
      endereco: i.endereco ?? ''
    });
    this.modalEditarAberto.set(true);
  }

  fecharModais() {
    this.modalVerAberto.set(false);
    this.modalEditarAberto.set(false);
    this.viewItem.set(null);
    this.editModel.set(null);
  }

  async salvarEdicao() {
    const m = this.editModel();
    if (!m?.id) return;

    this.saving.set(true);
    try {
      const patch: Partial<PreCadastro> = {
        nomeCompleto: m.nomeCompleto ?? null as any,
        cpf: this.onlyDigits(m.cpf as any) ?? null as any,
        telefone: this.onlyDigits(m.telefone as any) ?? null as any,
        email: (m.email ?? '').trim() || null as any,
        bairro: (m.bairro ?? '').trim() || null as any,
        endereco: (m.endereco ?? '').trim() || null as any,
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
    if (!item?.id) { console.warn('Tentativa de remover sem ID:', item); return; }
    const ok = confirm(`Remover o pré-cadastro de "${item.nomeCompleto ?? 'sem nome'}"?`);
    if (!ok) return;

    try {
      await this.service.remover(item.id);
      this.itens.update(lista => lista.filter(x => x.id !== item.id));
    } catch (err) {
      console.error('[PreCadastro] Erro ao remover:', err);
      alert('Falha ao remover. Tente novamente.');
    }
  }

  // ⬇️⬇️ NOVO: mesma lógica usada no Relatório
  private buildQueryFromPre(pc: PreCadastro): Record<string, any> {
    const contato = this.onlyDigits((pc as any)?.telefone ?? (pc as any)?.contato ?? '');
    const cpf = this.onlyDigits((pc as any)?.cpf ?? '');
    return {
      nome: (pc as any)?.nomeCompleto ?? (pc as any)?.nome ?? '',
      cpf,
      contato, // mesmo nome que o CadastroForm lê
      email: (pc as any)?.email ?? '',
      endereco: (pc as any)?.endereco ?? (pc as any)?.enderecoCompleto ?? '',
      preCadastroId: (pc as any)?.id ?? (pc as any)?.uid ?? '',
    };
  }

  iniciarCadastro(pc: PreCadastro) {
    // se algum modal estiver aberto, fecha por UX
    this.fecharModais();

    const qp = this.buildQueryFromPre(pc);
    // navega para /cadastro/novo com os query params preenchidos
    this.router.navigate(['/cadastro', 'novo'], { queryParams: qp });
  }
}
