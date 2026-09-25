import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null })
  parentCategoryId?: Types.ObjectId | null;

  @Prop()
  icon?: string;

  @Prop({ default: 0 })
  sortOrder!: number;

  @Prop()
  description?: string;

  /**
   * 整棵分类树共享的乐观锁版本：
   * 任何一次成功的层级移动都会 +1，客户端凭它检测并发冲突。
   */
  @Prop({ type: Number, default: 0 })
  treeVersion!: number;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
// parentCategoryId 是构建树和查询子树的主要入口
CategorySchema.index({ parentCategoryId: 1 });
