// Portée d'une condition dans une recette (01-contrats.md § 15.2, interprétations n° 1983). Règles complètes 4-10-1 et
// 4-10-2 : quand un « If » qui précède n'est pas rempli, ce qui suit ne se résout pas, « Then » compris ; quand c'est un
// « Then » qui précède et qui ne fait rien, ce qui suit se résout quand même. Dans une recette, la condition couvre donc
// les étapes qui la suivent : elles vont dans son `group`.
import type { Ability, Recipe, Step } from './types.ts';

const chained = (st: Step | undefined) => st?.link === 'then' || st?.link === 'and' || st?.link === 'ifYouDo' || st?.link === 'ifNotYouDo';

// Ce qui suit une étape sous condition lui est rattaché. « If C, you may A. If you do, B » reste tel quel : le lien
// « Si vous le faites » dépend déjà de l'étape conditionnelle.
export function coverThen(steps: Step[]): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = inner(steps[i]);
    let end = i + 1;
    while (chained(steps[end])) end++;
    const run = steps.slice(i + 1, end);
    if (!st.cond || !run.some((x) => x.link === 'then' || x.link === 'and')) { out.push(st); continue; }
    const { cond, link } = st;
    const head: Step[] = 'group' in st ? st.group : [withoutCond(st)];
    out.push({ ...(link ? { link } : {}), cond, group: coverThen([...head, ...run]) });
    i = end - 1;
  }
  return out;
}

function withoutCond(st: Step): Step {
  const { cond: _cond, link: _link, ...rest } = st;
  return rest as Step;
}

// Les listes d'étapes rangées dans une étape (choix, effet facultatif, groupe)
function inner(st: Step): Step {
  if ('group' in st) return { ...st, group: coverThen(st.group) };
  if ('may' in st) return { ...st, may: coverThen(st.may) };
  if ('chooseOne' in st) return { ...st, chooseOne: st.chooseOne.map(coverThen) };
  if (st.action.kind === 'oppChooseOne') return { ...st, action: { ...st.action, options: st.action.options.map(coverThen) } };
  return st;
}

const ofAbility = (ab: Ability): Ability => ({ ...ab, steps: coverThen(ab.steps) });

// La même recette, conditions étendues à ce qui les suit
export function coverRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    abilities: recipe.abilities.map(ofAbility),
    ...(recipe.trigger ? { trigger: ofAbility(recipe.trigger) } : {}),
  };
}

// Vrai si une condition de la recette laisse dehors ce qui la suit (le garde-fou de compare.ts)
export function hasUncoveredThen(recipe: Recipe): boolean {
  return JSON.stringify(coverRecipe(recipe)) !== JSON.stringify(recipe);
}
