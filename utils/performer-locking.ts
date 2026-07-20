import type { Performer, PerformerGroup } from '../types';

export function getEffectivelyLockedPerformerIds(
  performers: Performer[],
  groups: PerformerGroup[],
): Set<string> {
  const lockedGroupIds = new Set(groups.filter((group) => group.locked).map((group) => group.id));
  return new Set(
    performers
      .filter((performer) => performer.locked || (performer.groupId && lockedGroupIds.has(performer.groupId)))
      .map((performer) => performer.id),
  );
}

export function filterUnlockedPerformerIds(
  performerIds: string[],
  effectivelyLockedIds: ReadonlySet<string>,
): string[] {
  return performerIds.filter((id) => !effectivelyLockedIds.has(id));
}
