import { UserRole } from './enums';
import type { CategoryTreeNode } from '../utils/categoryTree';

export interface AuthUser {
  id: string;
  role: UserRole;
  canDownloadCommercial?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** PATCH /categories/:id/move 请求体；null/缺省表示移动为根分类。 */
export interface MoveCategoryPayload {
  parentCategoryId?: string | null;
  /** 调用方最近一次看到的分类树版本号，用于并发冲突检测，必填。 */
  baseVersion: number;
}

export interface MoveCategoryResult {
  category: unknown;
  treeVersion: number;
  tree: CategoryTreeNode[];
}

/** 移动冲突时返回给后落地请求的冲突信息，携带最新层级供调用方刷新。 */
export interface CategoryMoveConflict {
  code: 'CATEGORY_TREE_CONFLICT';
  currentVersion: number;
  tree: CategoryTreeNode[];
}
