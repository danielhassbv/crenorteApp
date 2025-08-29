import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

// Firebase Storage (usa a MESMA instância exportada em firebase.config.ts)
import { FirebaseStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage as fbStorage } from '../../firebase.config';

@Component({
  standalone: true,
  selector: 'app-colaboradores',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './colaboradores.component.html',
  styleUrls: ['./colaboradores.component.css']
})
export class ColaboradoresComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private storage: FirebaseStorage = fbStorage;

  loading = signal(false);
  erro = signal<string | null>(null);
  ok = signal<string | null>(null);

  // foto selecionada + preview
  private fotoFile: File | null = null;
  fotoPreview = signal<string | null>(null);

  form = this.fb.group({
    nome: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    senha: ['', [Validators.required, Validators.minLength(6)]],
    cpf: ['', [Validators.required, Validators.pattern(/^\d{11}$/)]], // só dígitos
    papel: ['assessor', Validators.required],
    cargo: [''],
    status: ['ativo', Validators.required],
  });

  // ---------- Handlers ----------
  onFotoChange(evt: Event) {
    const input = evt.target as HTMLInputElement;
    const f = input.files?.[0] || null;
    this.fotoFile = f ?? null;
    if (f) {
      const reader = new FileReader();
      reader.onload = () => this.fotoPreview.set(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      this.fotoPreview.set(null);
    }
  }

  cpfErro(): string | null {
    const c = this.form.get('cpf');
    if (!c || !c.touched) return null;
    const raw = String(c.value || '').replace(/\D/g, '');
    if (!raw) return 'CPF é obrigatório.';
    if (!/^\d{11}$/.test(raw)) return 'Informe 11 dígitos.';
    if (!this.validarCPF(raw)) return 'CPF inválido.';
    return null;
  }

  // ---------- Util ----------
  private validarCPF(cpf: string): boolean {
    if (!cpf || cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    let soma = 0, resto: number;
    for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10), 10)) return false;

    soma = 0;
    for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i-1, i), 10) * (12 - i);
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    return resto === parseInt(cpf.substring(10, 11), 10);
  }

  private async uploadFotoSeHouver(): Promise<string | null> {
    if (!this.fotoFile) return null;
    const safeName = (this.fotoFile.name || 'avatar').replace(/[^\w.\-]/g, '_');
    const path = `colaboradores/avatars/${Date.now()}-${safeName}`;
    const storageRef = ref(this.storage, path);
    await uploadBytes(storageRef, this.fotoFile, { contentType: this.fotoFile.type || 'image/jpeg' });
    return await getDownloadURL(storageRef);
  }

  // ---------- Ação principal ----------
  async criar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // valida CPF com dígitos
    const cpfDigits = String(this.form.value.cpf || '').replace(/\D/g, '');
    if (!this.validarCPF(cpfDigits)) {
      this.form.get('cpf')?.markAsTouched();
      this.erro.set('CPF inválido.');
      return;
    }

    this.loading.set(true);
    this.erro.set(null);
    this.ok.set(null);

    const v = this.form.value as any;

    try {
      // 1) (opcional) sobe a foto e obtém URL
      const photoURL = await this.uploadFotoSeHouver();

      // 2) cria o colaborador/usuário (Auth + perfil no Firestore)
      await this.auth.criarColaborador(v.email, v.senha, {
        nome: v.nome,
        email: v.email,
        cpf: cpfDigits,
        papel: v.papel,
        cargo: v.cargo,
        status: v.status,
        photoURL: photoURL || null,
      });

      this.ok.set('Colaborador criado com sucesso!');
      this.form.get('senha')?.reset();
      // this.form.reset({ papel: 'assessor', status: 'ativo' });
    } catch (e: any) {
      this.erro.set(e?.message ?? 'Falha ao criar colaborador');
    } finally {
      this.loading.set(false);
    }
  }
}
