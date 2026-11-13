import { randomUUID } from 'crypto';
import type { ProjectDocument } from '../project-contract.js';

// 每个项目独立的历史栈（内存态，随桌面端进程存活）
export interface McpChangeEntry {
  id: string;
  timestamp: number;
  projectId: string;
  toolName: string;
  description: string;
  before: ProjectDocument;
  after: ProjectDocument;
}

export interface McpChangeSummary {
  id: string;
  timestamp: number;
  projectId: string;
  toolName: string;
  description: string;
}

const MAX_ENTRIES_PER_PROJECT = 50;

export class McpChangeHistory {
  private undoStacks = new Map<string, McpChangeEntry[]>();
  private redoStacks = new Map<string, McpChangeEntry[]>();

  push(entry: Omit<McpChangeEntry, 'id' | 'timestamp'>): McpChangeEntry {
    const full: McpChangeEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    const stack = this.undoStacks.get(entry.projectId) ?? [];
    stack.push(full);
    if (stack.length > MAX_ENTRIES_PER_PROJECT) stack.shift();
    this.undoStacks.set(entry.projectId, stack);
    // 新变更使该项目的 redo 栈失效
    this.redoStacks.delete(entry.projectId);
    return full;
  }

  listUndoable(projectId: string): McpChangeSummary[] {
    return (this.undoStacks.get(projectId) ?? [])
      .map(({ id, timestamp, toolName, description }) => ({ id, timestamp, projectId, toolName, description }))
      .reverse();
  }

  peekUndo(projectId: string): McpChangeEntry | null {
    const stack = this.undoStacks.get(projectId);
    return stack && stack.length > 0 ? stack[stack.length - 1] : null;
  }

  popUndo(projectId: string): McpChangeEntry | null {
    const stack = this.undoStacks.get(projectId);
    const entry = stack?.pop() ?? null;
    if (entry) {
      const redo = this.redoStacks.get(projectId) ?? [];
      redo.push(entry);
      this.redoStacks.set(projectId, redo);
    }
    return entry;
  }

  popRedo(projectId: string): McpChangeEntry | null {
    const stack = this.redoStacks.get(projectId);
    const entry = stack?.pop() ?? null;
    if (entry) {
      const undo = this.undoStacks.get(projectId) ?? [];
      undo.push(entry);
      this.undoStacks.set(projectId, undo);
    }
    return entry;
  }

  canUndo(projectId: string): boolean {
    return this.peekUndo(projectId) !== null;
  }

  canRedo(projectId: string): boolean {
    const stack = this.redoStacks.get(projectId);
    return !!stack && stack.length > 0;
  }

  // 按 changeId 查找仍可回退（未撤销）的变更；返回其所在项目与栈内下标（自底向上）
  findUndoable(changeId: string): { entry: McpChangeEntry; index: number } | null {
    for (const [projectId, stack] of this.undoStacks) {
      const index = stack.findIndex((entry) => entry.id === changeId);
      if (index >= 0) return { entry: stack[index], index };
    }
    return null;
  }
}
