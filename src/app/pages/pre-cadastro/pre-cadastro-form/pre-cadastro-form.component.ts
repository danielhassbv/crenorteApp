import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { PreCadastroService } from '../../../services/pre-cadastro.service';
import { PreCadastro } from '../../../models/pre-cadastro.model';

declare const bootstrap: any;

type Star = 1 | 2 | 3 | 4 | 5;

type FeedbackCliente = {
  notaAtendimento: Star;
  cordialidade: Star;
  clareza: Star;
  recebeuInformacoesCompletas: boolean;
  recomendaria: boolean;
  comentarios?: string;
};

@Component({
  selector: 'app-pre-cadastro-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pre-cadastro-form.component.html',
  styleUrls: ['./pre-cadastro-form.component.css'],
})
export class PreCadastroFormComponent {
  private service = inject(PreCadastroService);
  private router = inject(Router);

  @ViewChild('feedbackModal', { static: false }) feedbackModalRef?: ElementRef<HTMLDivElement>;
  private feedbackModal?: any;

  loading = signal(false);
  msg = signal<string | null>(null);

  model: Omit<PreCadastro, 'id' | 'createdAt' | 'createdByUid' | 'createdByNome'> = {
    nomeCompleto: '',
    cpf: '',
    endereco: '',
    telefone: '',
    email: '',
  };

  private lastPreCadastroId: string | null = null;

  // Estado do feedback do cliente
  feedback: FeedbackCliente = {
    notaAtendimento: 5,
    cordialidade: 5,
    clareza: 5,
    recebeuInformacoesCompletas: true,
    recomendaria: true,
    comentarios: '',
  };
  stars: Star[] = [1, 2, 3, 4, 5];

  // ===== Utils =====
  private limpar(str: string) {
    return (str || '').trim();
  }

  private cpfValido(cpf: string): boolean {
    const s = (cpf || '').replace(/\D/g, '');
    if (s.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(s)) return false;

    const calcDV = (base: string, fatorInicial: number) => {
      let soma = 0;
      for (let i = 0; i < base.length; i++) {
        soma += parseInt(base[i], 10) * (fatorInicial - i);
      }
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };

    const dv1 = calcDV(s.substring(0, 9), 10);
    if (dv1 !== parseInt(s[9], 10)) return false;
    const dv2 = calcDV(s.substring(0, 10), 11);
    if (dv2 !== parseInt(s[10], 10)) return false;
    return true;
  }

  // ===== Fluxo principal =====
  async salvar(form: NgForm) {
    if (this.loading()) return;

    const payload = {
      nomeCompleto: this.limpar(this.model.nomeCompleto),
      cpf: this.limpar(this.model.cpf),
      endereco: this.limpar(this.model.endereco),
      telefone: this.limpar(this.model.telefone),
      email: this.limpar(this.model.email),
    };

    if (!form.valid || !this.cpfValido(payload.cpf)) {
      this.msg.set('Preencha os campos corretamente (CPF inválido).');
      return;
    }

    this.loading.set(true);
    this.msg.set(null);

    try {
      // criar() já seta createdByUid=auth.uid para atender às suas regras
      const id = await this.service.criar(payload);
      this.lastPreCadastroId = id;

      this.msg.set('Pré-cadastro salvo com sucesso!');
      form.resetForm();

      // abre modal para o CLIENTE avaliar o atendimento
      setTimeout(() => this.abrirFeedbackModal(), 0);
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar pré-cadastro:', e);
      this.msg.set(e?.message || 'Erro ao salvar o pré-cadastro.');
    } finally {
      this.loading.set(false);
    }
  }

  // ===== Modal feedback do cliente =====
  private abrirFeedbackModal() {
    if (!this.feedbackModalRef) return;
    this.feedbackModal = new bootstrap.Modal(this.feedbackModalRef.nativeElement, { backdrop: 'static' });
    this.feedbackModal.show();
  }

  fecharFeedbackModal() {
    this.feedbackModal?.hide();
  }

  setStar(field: keyof Pick<FeedbackCliente, 'notaAtendimento' | 'cordialidade' | 'clareza'>, v: Star) {
    this.feedback[field] = v;
  }

  async salvarFeedbackCliente() {
    if (!this.lastPreCadastroId) {
      this.msg.set('Não foi possível identificar o pré-cadastro para registrar o feedback.');
      return;
    }

    try {
      await this.service.registrarFeedbackCliente(this.lastPreCadastroId, this.feedback);
      this.msg.set('Avaliação do cliente registrada. Obrigado!');
      this.fecharFeedbackModal();
      // opcional:
      // this.router.navigateByUrl('/pre-cadastro/minha-lista');
    } catch (e: any) {
      console.error('[PreCadastro] Erro ao salvar feedback do cliente:', e);
      this.msg.set(e?.message || 'Erro ao salvar a avaliação do cliente.');
    }
  }
}
