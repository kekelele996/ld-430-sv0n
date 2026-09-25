import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MoveCategoryDto } from '../dto/move-category.dto';
import { Category, type CategoryDocument } from '../models/category.schema';
import { CategoryTreeMeta, type CategoryTreeMetaDocument } from '../models/categoryTreeMeta.schema';

/** 树形节点：在平铺分类之上递归挂 children */
export interface CategoryTreeNode {
  _id: string;
  name: string;
  parentCategoryId: string | null;
  icon?: string;
  sortOrder: number;
  description?: string;
  children: CategoryTreeNode[];
  [key: string]: unknown;
}

export interface CategoryTreeSnapshot {
  treeVersion: number;
  categories: CategoryDocument[];
  tree: CategoryTreeNode[];
}

type FlatCategory = {
  _id: unknown;
  parentCategoryId?: unknown;
  sortOrder?: number;
  name?: string;
};

@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(CategoryTreeMeta.name) private readonly treeMetaModel: Model<CategoryTreeMetaDocument>,
  ) {}

  findAll() {
    return this.categoryModel.find().sort({ sortOrder: 1, name: 1 }).exec();
  }

  create(payload: Partial<Category>) {
    return this.categoryModel.create(payload);
  }

  /** 通用编辑只允许改名称/图标/排序/描述；调整父级必须走 move，避免绕过循环与并发校验。 */
  update(id: string, payload: Partial<Category>) {
    const { parentCategoryId: _ignoredParent, treeVersion: _ignoredVersion, ...fields } = payload;
    return this.categoryModel.findByIdAndUpdate(id, fields, { new: true }).exec();
  }

  /** 返回分类树快照（当前版本 + 平铺列表 + 嵌套树）。 */
  async getTreeSnapshot(): Promise<CategoryTreeSnapshot> {
    const [categories, treeVersion] = await Promise.all([this.findAll(), this.currentVersion()]);
    return { treeVersion, categories, tree: assembleTree(categories) };
  }

  /**
   * 移动分类。
   * - 只改当前节点的 parentCategoryId，子孙节点的父指针不动，因此整棵子树自然跟随；
   * - 素材挂在分类 ID 上，分类移动后通过下级分类聚合查询仍然属于新位置；
   * - treeVersion 乐观锁：版本不匹配说明已有其他管理员先落地了移动，本次拒绝。
   */
  async moveCategory(categoryId: string, dto: MoveCategoryDto): Promise<CategoryTreeSnapshot> {
    const expectedVersion = dto.treeVersion;
    const newParentId = dto.parentCategoryId == null ? null : String(dto.parentCategoryId);

    const categories = await this.findAll();
    const byId = indexById(categories);
    const node = byId.get(categoryId);
    if (!node) throw new NotFoundException('被移动的分类不存在');

    if (newParentId !== null && !byId.has(newParentId)) {
      throw new NotFoundException('目标父分类不存在');
    }

    // 循环检测：从目标父级沿父指针向上走，若能走到被移动节点，
    // 说明目标父级就在该节点的子树里，移动后会成环。
    if (newParentId !== null && reachesAncestor(byId, newParentId, categoryId)) {
      const snapshot = await this.snapshotWith(await this.currentVersion(), categories);
      throw new BadRequestException({
        code: 'CATEGORY_CYCLE_DETECTED',
        message:
          newParentId === categoryId
            ? '不能把分类移动到自身下面，否则会形成循环引用'
            : '目标分类是当前分类的下级，移动过去会形成循环引用，已保留原层级',
        currentTree: snapshot.tree,
        treeVersion: snapshot.treeVersion,
      });
    }

    const oldParentId = node.parentCategoryId == null ? null : String(node.parentCategoryId);
    // 已经在目标父级下：层级不变，不消耗版本号。
    if (oldParentId === newParentId) {
      return this.snapshotWith(await this.currentVersion(), categories);
    }

    // 乐观锁 CAS：只有版本号仍然等于客户端看到的版本时才 +1。
    // 并发场景下同一时刻只有一个请求能匹配成功，先落地的生效。
    const cas = await this.treeMetaModel.updateOne({ version: expectedVersion }, { $inc: { version: 1 } }).exec();
    if (cas.matchedCount === 0) {
      const serverVersion = await this.currentVersion();
      const snapshot = await this.snapshotWith(serverVersion);
      throw new ConflictException({
        code: 'CATEGORY_TREE_VERSION_CONFLICT',
        message: '分类树已被其他管理员更新，请基于最新层级重试移动',
        serverVersion: snapshot.treeVersion,
        currentTree: snapshot.tree,
        categories: snapshot.categories,
      });
    }

    // 父级是分类上的单值字段，一次只可能指向一个父分类，
    // 配合上面的 CAS 串行化，树不会出现两条父级。
    // 若此步失败，版本已前进而层级未变，调用方刷新后会收到一次冲突并重试恢复。
    await this.categoryModel.updateOne({ _id: categoryId }, { $set: { parentCategoryId: newParentId } }).exec();

    return this.snapshotWith(expectedVersion + 1);
  }

  /**
   * 返回某分类及其全部下级分类的 ID（按子树递归）。
   * 浏览素材时用于聚合所有下级分类里的素材。
   */
  async findCategorySubtreeIds(categoryId: string): Promise<string[]> {
    const categories = await this.categoryModel
      .find()
      .select({ _id: 1, parentCategoryId: 1 })
      .sort({ sortOrder: 1, name: 1 })
      .lean<FlatCategory[]>()
      .exec();
    const byId = indexById(categories);
    if (!byId.has(categoryId)) throw new NotFoundException('分类不存在');
    return [...collectSubtree(byId, categoryId)];
  }

  /** 读取（必要时初始化）整棵树唯一的版本号文档。 */
  private async currentVersion(): Promise<number> {
    await this.treeMetaModel.updateOne({}, { $setOnInsert: { version: 0 } }, { upsert: true }).exec();
    const meta = await this.treeMetaModel.findOne().lean<{ version: number } | null>().exec();
    return meta?.version ?? 0;
  }

  private async snapshotWith(treeVersion: number, prefetched?: CategoryDocument[]): Promise<CategoryTreeSnapshot> {
    const categories = prefetched ?? (await this.findAll());
    return { treeVersion, categories, tree: assembleTree(categories) };
  }
}

/** 以 _id 字符串为键建立索引。 */
function indexById<T extends FlatCategory>(categories: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const category of categories) {
    map.set(String(category._id), category);
  }
  return map;
}

/**
 * 从 startId 沿父指针向上游走：
 * 若能到达 ancestorId，说明 startId 位于 ancestorId 的子树中。
 * 对存量脏数据自带的环用 visited 截断，避免死循环。
 */
function reachesAncestor(byId: Map<string, FlatCategory>, startId: string, ancestorId: string): boolean {
  let current: string | null = startId;
  const visited = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (visited.has(current)) return false;
    visited.add(current);
    const node = byId.get(current);
    current = node?.parentCategoryId == null ? null : String(node.parentCategoryId);
  }
  return false;
}

/** 收集 rootId 自身与全部后代 ID（BFS，visited 防止存量环导致死循环）。 */
function collectSubtree(byId: Map<string, FlatCategory>, rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const [id, category] of byId) {
    if (category.parentCategoryId == null) continue;
    const parentId = String(category.parentCategoryId);
    const list = childrenOf.get(parentId);
    if (list) list.push(id);
    else childrenOf.set(parentId, [id]);
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const childId of childrenOf.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

/**
 * 把平铺分类组装成嵌套树。
 * 父级缺失（孤儿节点）或存量环导致从根不可达的节点，兜底挂到根层，保证仍可见。
 */
function assembleTree(categories: FlatCategory[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const category of categories) {
    const source = category as Record<string, unknown>;
    nodes.set(String(category._id), {
      ...(source as object),
      _id: String(category._id),
      parentCategoryId: category.parentCategoryId == null ? null : String(category.parentCategoryId),
      children: [],
    } as unknown as CategoryTreeNode);
  }

  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentCategoryId ? nodes.get(node.parentCategoryId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // 修补从根不可达的节点（纯环节点），避免它们从树里消失。
  const reachable = new Set<string>();
  const walk = (node: CategoryTreeNode) => {
    if (reachable.has(node._id)) return;
    reachable.add(node._id);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  for (const node of nodes.values()) {
    if (!reachable.has(node._id)) roots.push(node);
  }

  const sortNodes = (list: CategoryTreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    list.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}
