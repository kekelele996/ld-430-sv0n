import type { Types } from 'mongoose';

/** 对外返回的分类树节点，ID 统一序列化为字符串并携带子节点。 */
export interface CategoryTreeNode {
  _id: string;
  name: string;
  parentCategoryId: string | null;
  icon?: string;
  sortOrder: number;
  description?: string;
  children: CategoryTreeNode[];
}

/** 仅依赖分类文档形状的最小结构，lean() 与 Mongoose 文档均可使用。 */
export interface CategoryTreeSource {
  _id: Types.ObjectId | string;
  name: string;
  parentCategoryId?: Types.ObjectId | string | null;
  icon?: string;
  sortOrder?: number;
  description?: string;
}

const asId = (value: Types.ObjectId | string): string => String(value);

/**
 * 把扁平的分类列表组装成嵌套树。
 * 输入应已按 sortOrder/name 排序，子节点会保持同样的相对顺序；
 * 父节点缺失的孤儿分类会被防御性地挂到根层，避免从树上丢失。
 */
export function buildCategoryTree(categories: CategoryTreeSource[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const category of categories) {
    const id = asId(category._id);
    nodes.set(id, {
      _id: id,
      name: category.name,
      parentCategoryId: category.parentCategoryId ? asId(category.parentCategoryId) : null,
      icon: category.icon,
      sortOrder: category.sortOrder ?? 0,
      description: category.description,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parentCategoryId;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * 收集某个分类下的全部后代 ID（不含自身），基于邻接关系逐层展开。
 * visited 同时防御历史脏数据中可能存在的环状引用。
 */
export function collectDescendantIds(rootId: string, categories: CategoryTreeSource[]): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parentCategoryId) continue;
    const parentId = asId(category.parentCategoryId);
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(asId(category._id));
    childrenByParent.set(parentId, siblings);
  }

  const descendantIds: string[] = [];
  const visited = new Set<string>([rootId]);
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    descendantIds.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return descendantIds;
}
