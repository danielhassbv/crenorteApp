// src/app/guards/role.guard.ts
import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ActivatedRouteSnapshot } from '@angular/router';
import { map } from 'rxjs';
import { Papel } from '../models/colaborador.model';

export const roleGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const roles = (route.data?.['roles'] ?? []) as Papel[];
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.temPapel$(roles).pipe(
    map(ok => {
      if (ok) return true;
      router.navigate(['/acesso-negado']);
      return false;
    })
  );
};
