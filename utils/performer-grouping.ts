import type { Performer, PerformerGroup } from '../types';

export type GroupablePerformerType = 'performer' | 'prop';

export interface GroupAction {
  performerIds: string[];
  performerType: GroupablePerformerType;
}

export function getGroupablePerformerType(
  performer: Pick<Performer, 'type'>,
): GroupablePerformerType {
  return performer.type === 'prop' ? 'prop' : 'performer';
}

export function isPerformerGroupCompatible(
  group: Pick<PerformerGroup, 'type'>,
  performerType: GroupablePerformerType,
): boolean {
  const groupType = group.type === 'prop' ? 'prop' : 'performer';
  return groupType === performerType;
}

export function resolveGroupAction(
  performers: Array<Pick<Performer, 'id' | 'type'>>,
  selectedIds: string[],
  initiatorId: string,
): GroupAction | null {
  const performerById = new Map(performers.map((performer) => [performer.id, performer]));
  const initiator = performerById.get(initiatorId);
  if (!initiator) return null;

  const performerType = getGroupablePerformerType(initiator);
  if (!selectedIds.includes(initiatorId)) {
    return { performerIds: [initiatorId], performerType };
  }

  const compatibleIds = selectedIds.filter((id) => {
    const performer = performerById.get(id);
    return performer && getGroupablePerformerType(performer) === performerType;
  });

  return {
    performerIds: compatibleIds.length > 0 ? compatibleIds : [initiatorId],
    performerType,
  };
}
