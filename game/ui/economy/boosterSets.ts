// Boosters à ouvrir de plusieurs extensions à la fois (coffre de la semaine OP03, récompenses d'Alabasta OP04,
// boutique) : ce que l'écran annonce doit être ce qui s'ouvre. Chaque booster garde son extension (game_boosters.set_code,
// lue à l'ouverture par le serveur) ; ces fonctions servent à l'annoncer sans la confondre avec celle du premier booster.
export interface SetCount { set: string; count: number }

// Nombre de boosters par extension, dans l'ordre où chaque extension apparaît
export function countBySet(boosters: readonly { set: string }[]): SetCount[] {
  const counts = new Map<string, number>();
  for (const b of boosters) counts.set(b.set, (counts.get(b.set) ?? 0) + 1);
  return [...counts].map(([set, count]) => ({ set, count }));
}

// Les boosters rangés par extension (ordre stable : extensions dans l'ordre où elles apparaissent, boosters dans leur
// ordre à l'intérieur) : on ouvre tous ceux d'une extension, puis ceux de la suivante
export function groupBySet<T extends { set: string }>(boosters: readonly T[]): T[] {
  const order = countBySet(boosters).map((c) => c.set);
  return order.flatMap((set) => boosters.filter((b) => b.set === set));
}

// « 2 OP04 et 1 OP03 », « 3 OP04, 2 OP03 et 1 OP05 »
export function setsText(boosters: readonly { set: string }[]): string {
  const parts = countBySet(boosters).map((c) => `${c.count} ${c.set}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} et ${parts[parts.length - 1]}` : parts.join('');
}
