// src/app/pages/colaboradores/colaboradores.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-colaboradores',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
  <div class="container py-4">
    <h3 class="mb-3">Gerenciar Colaboradores</h3>
    <form [formGroup]="form" (ngSubmit)="criar()">
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label">Nome</label>
          <input class="form-control" formControlName="nome">
        </div>
        <div class="col-md-6">
          <label class="form-label">E-mail</label>
          <input class="form-control" formControlName="email" type="email">
        </div>
        <div class="col-md-6">
          <label class="form-label">Senha (inicial)</label>
          <input class="form-control" formControlName="senha" type="password">
        </div>
        <div class="col-md-6">
          <label class="form-label">Papel</label>
          <select class="form-select" formControlName="papel">
            <option value="admin">Administrador</option>
            <option value="supervisor">Supervisor</option>
            <option value="coordenador">Coordenador</option>
            <option value="assessor">Assessor</option>
            <option value="operacional">Operacional</option>
            <option value="rh">RH</option>
            <option value="financeiro">Financeiro</option>
            <option value="qualidade">Controle de Qualidade</option>
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label">Cargo (opcional)</label>
          <input class="form-control" formControlName="cargo">
        </div>
        <div class="col-md-6">
          <label class="form-label">Status</label>
          <select class="form-select" formControlName="status">
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </select>
        </div>
      </div>
      <button class="btn btn-success mt-3" [disabled]="form.invalid || loading()">Criar colaborador</button>
      <div class="text-danger mt-2" *ngIf="erro()">{{erro()}}</div>
      <div class="text-success mt-2" *ngIf="ok()">{{ok()}}</div>
    </form>
  </div>
  `
})
export class ColaboradoresComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);

  loading = signal(false);
  erro = signal<string | null>(null);
  ok = signal<string | null>(null);

  form = this.fb.group({
    nome: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
    papel: ['assessor', Validators.required],
    cargo: [''],
    status: ['ativo', Validators.required],
  });

  async criar() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.erro.set(null);
    this.ok.set(null);
    const v = this.form.value as any;

    try {
      // ✅ NÃO envie uid/criadoEm aqui
      await this.auth.criarColaborador(v.email, v.senha, {
        nome: v.nome,
        email: v.email,
        papel: v.papel,
        cargo: v.cargo,
        status: v.status,
      });

      this.ok.set('Colaborador criado com sucesso!');
      this.form.get('senha')?.reset();
    } catch (e: any) {
      this.erro.set(e?.message ?? 'Falha ao criar colaborador');
    } finally {
      this.loading.set(false);
    }
  }
}
