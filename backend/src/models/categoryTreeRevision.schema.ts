import { HydratedDocument } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * 单例文档：记录整棵分类树的结构版本号。
 * 每次成功移动分类都会通过版本号 CAS 抢占，保证并发移动串行生效，
 * 后落地的请求拿到 409 冲突和最新层级，而不是覆盖先落地的结果。
 */
@Schema({ collection: 'category_tree_revisions', timestamps: true })
export class CategoryTreeRevision {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true, default: 0 })
  version!: number;

  @Prop()
  lastMovedCategoryId?: string;
}

export const CATEGORY_TREE_REVISION_KEY = 'category-tree';

export type CategoryTreeRevisionDocument = HydratedDocument<CategoryTreeRevision>;

export const CategoryTreeRevisionSchema = SchemaFactory.createForClass(CategoryTreeRevision);
