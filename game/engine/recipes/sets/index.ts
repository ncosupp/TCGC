// Point d'enregistrement des recettes : chaque tâche « set » ajoute l'import de son fichier recipes/sets/<set>.ts et
// son RecipeSet à la fin de RECIPE_SETS (une ligne chacun, sans réorganiser le reste). Chargées par C1.1 après le
// code à la main (le code à la main l'emporte).
import type { RecipeSet } from '../types.ts';
import { RECIPES_EB05 } from './eb05.ts';
import { RECIPES_OP17 } from './op17.ts';
import { RECIPES_OP16 } from './op16.ts';
import { RECIPES_OP15 } from './op15.ts';
import { RECIPES_EB03 } from './eb03.ts';
import { RECIPES_EB04 } from './eb04.ts';
import { RECIPES_OP14 } from './op14.ts';
import { RECIPES_ST29 } from './st29.ts';
import { RECIPES_OP09 } from './op09.ts';
import { RECIPES_ST20 } from './st20.ts';
import { RECIPES_ST19 } from './st19.ts';
import { RECIPES_ST17 } from './st17.ts';
import { RECIPES_ST16 } from './st16.ts';

export const RECIPE_SETS: RecipeSet[] = [
  RECIPES_EB05,
  RECIPES_OP17,
  RECIPES_OP16,
  RECIPES_OP15,
  RECIPES_EB03,
  RECIPES_EB04,
  RECIPES_OP14,
  RECIPES_ST29,
  RECIPES_OP09,
  RECIPES_ST20,
  RECIPES_ST19,
  RECIPES_ST17,
  RECIPES_ST16,
];
