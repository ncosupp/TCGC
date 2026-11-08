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
import { RECIPES_OP13 } from './op13.ts';
import { RECIPES_PRB02 } from './prb02.ts';
import { RECIPES_OP12 } from './op12.ts';
import { RECIPES_ST28 } from './st28.ts';
import { RECIPES_ST27 } from './st27.ts';
import { RECIPES_ST25 } from './st25.ts';
import { RECIPES_ST23 } from './st23.ts';
import { RECIPES_OP11 } from './op11.ts';
import { RECIPES_EB02 } from './eb02.ts';
import { RECIPES_OP10 } from './op10.ts';
import { RECIPES_OP09 } from './op09.ts';
import { RECIPES_ST20 } from './st20.ts';
import { RECIPES_ST19 } from './st19.ts';
import { RECIPES_ST17 } from './st17.ts';
import { RECIPES_ST16 } from './st16.ts';
import { RECIPES_OP08 } from './op08.ts';
import { RECIPES_ST14 } from './st14.ts';

export const RECIPE_SETS: RecipeSet[] = [
  RECIPES_EB05,
  RECIPES_OP17,
  RECIPES_OP16,
  RECIPES_OP15,
  RECIPES_EB03,
  RECIPES_EB04,
  RECIPES_OP14,
  RECIPES_ST29,
  RECIPES_OP13,
  RECIPES_PRB02,
  RECIPES_OP12,
  RECIPES_ST28,
  RECIPES_ST27,
  RECIPES_ST25,
  RECIPES_ST23,
  RECIPES_OP11,
  RECIPES_EB02,
  RECIPES_OP10,
  RECIPES_OP09,
  RECIPES_ST20,
  RECIPES_ST19,
  RECIPES_ST17,
  RECIPES_ST16,
  RECIPES_OP08,
  RECIPES_ST14,
];
