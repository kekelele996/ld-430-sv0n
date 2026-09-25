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

interface FindAssetsQuery {
  keyword?: string;
  tag?: string;
  status?: AssetStatus;
  categoryId?: string;
}

@Injectable()
export class AssetService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
    private readonly tagService: TagService,
    private readonly storageService: StorageService,
    private readonly categoryService: CategoryService,
  ) {}

  async findAll(query: FindAssetsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.tag) filter.tags = query.tag;
    if (query.keyword) filter.$text = { $search: query.keyword };

    if (query.categoryId) {
      // 选中某分类时，聚合该分类及其全部下级分类的素材。
      const categoryIds = await this.categoryService.findCategoryWithDescendantIds(query.categoryId);
      if (!categoryIds) throw new NotFoundException('分类不存在');
      filter.categoryId = { $in: categoryIds };
      // 浏览场景默认只返回已发布素材；显式传入 status（如管理员排查）时尊重该条件。
      filter.status = query.status ?? AssetStatus.Published;
    } else if (query.status) {
      filter.status = query.status;
    }

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
