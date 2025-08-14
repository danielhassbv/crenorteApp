// src/app/pages/login/login.component.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
  <div class="container py-5" style="max-width: 420px;">
    <h3 class="mb-3">Entrar</h3>
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="mb-3">
        <label class="form-label">E-mail</label>
        <input type="email" class="form-control" formControlName="email" />
      </div>
      <div class="mb-3">
        <label class="form-label">Senha</label>
        <input type="password" class="form-control" formControlName="senha" />
      </div>
      <button class="btn btn-success w-100" [disabled]="form.invalid || loading()">Entrar</button>
      <button type="button" class="btn btn-link mt-2" (click)="reset()">Esqueci minha senha</button>
      <div class="text-danger mt-2" *ngIf="erro()">{{erro()}}</div>
    </form>
  </div>
  `
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = signal(false);
  erro = signal<string | null>(null);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
  });

  async onSubmit() {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.erro.set(null);
    const { email, senha } = this.form.value as any;
    try {
      await this.auth.login(email, senha);
      await this.auth.garantirPerfilMinimo();
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      this.erro.set(e?.message ?? 'Falha no login');
    } finally {
      this.loading.set(false);
    }
  }

  async reset() {
    const email = this.form.get('email')?.value;
    if (!email) { this.erro.set('Informe seu e-mail para recuperar a senha.'); return; }
    try {
      await this.auth.resetSenha(email);
      this.erro.set('Enviamos um link de redefinição para seu e-mail.');
    } catch (e: any) {
      this.erro.set(e?.message ?? 'Falha ao enviar e-mail de redefinição');
    }
  }
}
