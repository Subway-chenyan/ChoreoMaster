# Batch Performer Grouping Design

## Scope

Extend the existing performer/prop sidebar so a compatible multi-selection can be assigned to or removed from a group through either the context menu or drag and drop.

## Selection rules

- Existing Ctrl/Cmd click and stage box-selection behavior remains unchanged.
- Right-clicking or dragging an already selected item operates on every selected item of the same type as the clicked item.
- Right-clicking or dragging an unselected item first replaces the selection with that item and operates on it alone.
- A mixed stage selection is valid, but a grouping action filters it by the initiating item's type. Incompatible selected items remain selected and unchanged.
- Performer groups accept only performers. Prop groups accept only props.

## Context menu

- Context-menu state stores the complete compatible performer ID list rather than one performer ID.
- The menu heading communicates the operation count, for example `移动 3 个演员到分组`.
- Available destination groups are filtered by the initiating type.
- `移至未分组` applies to the entire compatible ID list.
- Choosing a destination closes the menu after one batch state update.

## Drag and drop

- Drag state stores the compatible performer ID list and its type.
- The dragged row remains the visual origin, while selected rows in the payload use a subdued dragging style.
- A compatible group header highlights during drag-over and shows `拖入 N 项`.
- Incompatible groups do not accept the drag or display an active drop state.
- The ungrouped header accepts either type within the current tab and removes every dragged ID from its group.
- Dropping performs one batch state update and clears drag/drop state.

## Component boundary

- `Sidebar.tsx` owns selection derivation, drag payload state, context-menu state, type validation, and visual feedback.
- `App.tsx` owns immutable batch updates to the persisted `performers` collection.
- Add a batch ungroup callback alongside the existing batch group callback. Keep singular callbacks for existing callers until they can be removed safely.
- No project schema migration is required because `Performer.groupId` and `PerformerGroup.type` already persist the necessary state.

## Edge behavior

- Empty compatible selection falls back to the initiating item.
- Missing destination groups show the existing empty menu state.
- Dropping outside a target makes no data change and clears drag feedback.
- Deleting a group retains the existing behavior of moving all members to ungrouped.

## Verification

- Pure or source regression tests cover selected-item batching, unselected-item fallback, same-type filtering, batch group and ungroup callbacks, and drag target state.
- Browser verification covers context-menu count text, batch destination assignment, group-header highlight, batch drag to another group, and batch drag to ungrouped.
- The existing desktop test suite and production build must continue to pass.
