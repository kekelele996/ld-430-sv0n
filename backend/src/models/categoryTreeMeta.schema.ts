import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CategoryTreeMetaDocument = HydratedDocument<CategoryTreeMeta>;

/**
 * 分类树的全局元数据。集合中永远只有一条单例文档，
 * version 作为整棵树的乐观锁：任何层级移动成功后 +1。
 * 单独建集合而不是写在每条分类上，保证并发时 CAS 只作用在同一行上。
 */
@Schema({ collection: 'category_tree_meta' })
export class CategoryTreeMeta {
  @Prop({ type: Number, default: 0 })
  version!: number;
}

export const CategoryTreeMetaSchema = SchemaFactory.createForClass(CategoryTreeMeta);
