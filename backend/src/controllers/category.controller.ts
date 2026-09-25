import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Category } from '../models/category.schema';
import { CATEGORY_ROUTES } from '../routes/category.routes';
import { CategoryService } from '../services/category.service';
import type { MoveCategoryPayload } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('categories')
@Controller(CATEGORY_ROUTES.root)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  @ApiOperation({ summary: '获取多级分类树及当前树版本号' })
  async findAll() {
    const { treeVersion, tree } = await this.categoryService.findTree();
    return ok({ treeVersion, tree });
  }

  @Post()
  async create(@Body() payload: Partial<Category>) {
    return ok(await this.categoryService.create(payload), '分类已创建');
  }

  @Patch(CATEGORY_ROUTES.detail)
  async update(@Param('id') id: string, @Body() payload: Partial<Category>) {
    return ok(await this.categoryService.update(id, payload), '分类已更新');
  }

  @Patch(CATEGORY_ROUTES.move)
  @ApiOperation({ summary: '移动分类（含整个下级层级），基于 treeVersion 做并发冲突检测' })
  async move(@Param('id') id: string, @Body() payload: MoveCategoryPayload) {
    return ok(await this.categoryService.move(id, payload), '分类已移动');
  }
}
