import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, type AssetDocument } from '../models/asset.schema';
import { AssetStatus } from '../types/enums';
import { validateFileFormat } from '../utils/fileValidator';
import { thumbnailFromUrl } from '../utils/thumbnailGenerator';
import { TagService } from './tag.service';
import { StorageService } from './storage.service';
import { CategoryService } from './category.service';

export interface AssetQuery {
  keyword?: string;
  tag?: string;
  status?: AssetStatus;
  /** 浏览某分类时聚合该分类及全部下级分类中的素材 */
  categoryId?: string;
  /**
   * 是否只看已发布素材。按分类浏览默认 true，
   * 显式传 status 时以 status 为准。
   */
  publishedOnly?: boolean;
}

@Injectable()
export class AssetService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
    private readonly tagService: TagService,
    private readonly storageService: StorageService,
    private readonly categoryService: CategoryService,
  ) {}

  async findAll(query: AssetQuery) {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    else if (query.publishedOnly) filter.status = AssetStatus.Published;
    if (query.tag) filter.tags = query.tag;
    if (query.categoryId) {
      // 选择某个分类浏览时，连同所有下级分类里的素材一起返回
      const categoryIds = await this.categoryService.findCategorySubtreeIds(query.categoryId);
      filter.categoryId = { $in: categoryIds };
    }
    if (query.keyword) filter.$text = { $search: query.keyword };
    return this.assetModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string) {
    const asset = await this.assetModel.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }, { new: true }).exec();
    if (!asset) throw new NotFoundException('素材不存在');
    return asset;
  }

  async create(payload: Partial<Asset>) {
    if (!payload.assetType || !payload.fileFormat || !validateFileFormat(payload.assetType, payload.fileFormat)) {
      throw new BadRequestException('文件格式与素材类型不匹配');
    }
    const fileUrl = payload.fileUrl ?? this.storageService.presignedUploadUrl(`${Date.now()}-${payload.title ?? 'asset'}.${payload.fileFormat}`);
    const asset = await this.assetModel.create({
      ...payload,
      fileUrl,
      thumbnailUrl: payload.thumbnailUrl ?? thumbnailFromUrl(fileUrl),
    });
    await this.tagService.upsertMany(asset.tags ?? []);
    return asset;
  }

  update(id: string, payload: Partial<Asset>) {
    return this.assetModel.findByIdAndUpdate(id, payload, { new: true }).exec();
  }

  publish(id: string) {
    return this.assetModel.findByIdAndUpdate(id, { status: AssetStatus.Published }, { new: true }).exec();
  }

  archive(id: string) {
    return this.assetModel.findByIdAndUpdate(id, { status: AssetStatus.Archived }, { new: true }).exec();
  }

  incrementDownload(id: string) {
    return this.assetModel.findByIdAndUpdate(id, { $inc: { downloadCount: 1 } }, { new: true }).exec();
  }
}
