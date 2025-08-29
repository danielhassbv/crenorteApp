// src/app/pages/home/home.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { Colaborador } from '../../models/colaborador.model';
import { HeaderComponent } from '../shared/header/header.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, HeaderComponent],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css'],
})
export class HomeComponent {
  // ✅ injeta o service e expõe um observable tipado pra template
  public auth = inject(AuthService);
  public perfil$: Observable<Colaborador | null> = this.auth.perfil$;
}
