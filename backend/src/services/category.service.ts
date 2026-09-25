import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { Category, type CategoryDocument } from '../models/category.schema';
import {
  CATEGORY_TREE_REVISION_KEY,
  CategoryTreeRevision,
  type CategoryTreeRevisionDocument,
} from '../models/categoryTreeRevision.schema';
import type { CategoryTreeNode, CategoryTreeSource } from '../utils/categoryTree';
import { buildCategoryTree, collectDescendantIds } from '../utils/categoryTree';
import type { MoveCategoryPayload, MoveCategoryResult } from '../types/interfaces';

type Snapshot = {
  version: number;
  categories: CategoryTreeSource[];
  tree: CategoryTreeNode[];
};

@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(CategoryTreeRevision.name)
    private readonly revisionModel: Model<CategoryTreeRevisionDocument>,
  ) {}

  private async loadCategories() {
    return this.categoryModel.find().sort({ sortOrder: 1, name: 1 }).lean().exec();
  }

  /** 读取当前分类树快照：版本号 + 扁平分类 + 嵌套树。 */
  private async getSnapshot(): Promise<Snapshot> {
    const revision = await this.revisionModel
      .findOneAndUpdate(
        { key: CATEGORY_TREE_REVISION_KEY },
        { $setOnInsert: { key: CATEGORY_TREE_REVISION_KEY, version: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    const categories = (await this.loadCategories()) as unknown as CategoryTreeSource[];
    return { version: revision.version, categories, tree: buildCategoryTree(categories) };
  }

  async findTree(): Promise<{ treeVersion: number; tree: CategoryTreeNode[] }> {
    const snapshot = await this.getSnapshot();
    return { treeVersion: snapshot.version, tree: snapshot.tree };
  }

  async create(payload: Partial<Category>) {
    if (payload.parentCategoryId != null && !isValidObjectId(payload.parentCategoryId)) {
      throw new BadRequestException('父分类不存在');
    }
    if (payload.parentCategoryId != null) {
      const parent = await this.categoryModel.findById(payload.parentCategoryId).exec();
      if (!parent) throw new BadRequestException('父分类不存在');
    }
    return this.categoryModel.create(payload);
  }

  async update(id: string, payload: Partial<Category>) {
    // parentCategoryId 只能通过 move 接口调整，普通编辑改父级会绕过循环检测和版本抢占。
    if ('parentCategoryId' in payload) {
      throw new BadRequestException('调整父分类请使用 PATCH /categories/:id/move');
    }
    const category = await this.categoryModel.findByIdAndUpdate(id, payload, { new: true }).exec();
    if (!category) throw new NotFoundException('分类不存在');
    return category;
  }

  /**
   * 移动分类。邻接表模型下只需改写被移动节点的 parentCategoryId，
   * 它的全部子分类仍指向该节点，因此整个层级会一起跟到新父级下；
   * 素材只记录直属分类，同样随该分类一起移动，无需批量改写。
   *
   * 并发控制：以树版本号做 CAS 抢占，先落地的请求 +1 成功，
   * 后落地的请求版本不匹配，返回 409 和最新层级，不会出现两条父级。
   */
  async move(id: string, payload: MoveCategoryPayload): Promise<MoveCategoryResult> {
    if (!isValidObjectId(id)) throw new BadRequestException('分类不存在');
    if (payload == null || typeof payload.baseVersion !== 'number') {
      throw new BadRequestException('缺少 baseVersion，请基于最新的分类树版本提交移动');
    }
    const targetParentId = payload.parentCategoryId ?? null;
    if (targetParentId !== null && !isValidObjectId(targetParentId)) {
      throw new BadRequestException('目标父分类不存在');
    }

    // 先做与版本无关的校验，版本过期时也能得到明确的参数错误。
    const category = await this.categoryModel.findById(id).exec();
    if (!category) throw new NotFoundException('分类不存在');
    if (targetParentId !== null && targetParentId === id) {
      throw new BadRequestException('不能把分类移动到自己下面，否则会形成循环引用');
    }
    if (targetParentId !== null) {
      const targetParent = await this.categoryModel.findById(targetParentId).exec();
      if (!targetParent) throw new BadRequestException('目标父分类不存在');
    }

    const snapshot = await this.getSnapshot();
    if (snapshot.version !== payload.baseVersion) {
      throw this.treeConflict(snapshot);
    }

    // 不能移动到自身的任意下级：目标父级若在当前子树内，挂上后即形成环。
    const descendantIds = collectDescendantIds(id, snapshot.categories);
    if (targetParentId !== null && descendantIds.includes(targetParentId)) {
      throw new BadRequestException('不能把分类移动到它自己的下级分类，层级将保持不变，否则会形成循环引用');
    }

    // CAS 抢占树版本：只有一个并发请求能把版本从 baseVersion 推进到 +1。
    const claimed = await this.revisionModel
      .findOneAndUpdate(
        { key: CATEGORY_TREE_REVISION_KEY, version: payload.baseVersion },
        { $inc: { version: 1 }, $set: { lastMovedCategoryId: id } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw this.treeConflict(await this.getSnapshot());
    }

    // 附加 parentCategoryId 当前值条件做二次防御：抢占期间结构不可能变化，
    // 一旦不一致则回滚版本并按冲突处理，保证树不会被写出两条父级。
    const currentParentId = category.parentCategoryId ? String(category.parentCategoryId) : null;
    const parentFilter =
      currentParentId === null
        ? { $or: [{ parentCategoryId: null }, { parentCategoryId: { $exists: false } }] }
        : { parentCategoryId: new Types.ObjectId(currentParentId) };
    const updated = await this.categoryModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ...parentFilter },
        { $set: { parentCategoryId: targetParentId === null ? null : new Types.ObjectId(targetParentId) } },
        { new: true },
      )
      .exec();

    if (!updated) {
      // 极端竞态下条件更新落空：回滚本次版本抢占，让整棵树回到未移动状态。
      await this.revisionModel
        .findOneAndUpdate({ key: CATEGORY_TREE_REVISION_KEY, version: claimed.version }, { $inc: { version: -1 } })
        .exec();
      throw this.treeConflict(await this.getSnapshot());
    }

    const result = await this.getSnapshot();
    return { category: updated, treeVersion: result.version, tree: result.tree };
  }

  /**
   * 返回某分类及其全部下级分类的 ID，用于按分类浏览素材时聚合子树素材。
   */
  async findCategoryWithDescendantIds(categoryId: string): Promise<string[] | null> {
    if (!isValidObjectId(categoryId)) throw new BadRequestException('分类不存在');
    const categories = (await this.loadCategories()) as unknown as CategoryTreeSource[];
    if (!categories.some((item) => String(item._id) === categoryId)) return null;
    return [categoryId, ...collectDescendantIds(categoryId, categories)];
  }

  private treeConflict(snapshot: Snapshot): ConflictException {
    return new ConflictException({
      code: 'CATEGORY_TREE_CONFLICT',
      message: '分类树已被其他管理员调整，当前移动未生效，请基于最新层级重试',
      currentVersion: snapshot.version,
      tree: snapshot.tree,
    });
  }
}
