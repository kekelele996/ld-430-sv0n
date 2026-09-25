import { Body, Controller, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MoveCategoryDto } from '../dto/move-category.dto';
import { Category } from '../models/category.schema';
import { CATEGORY_ROUTES } from '../routes/category.routes';
import { CategoryService } from '../services/category.service';
import { ok } from '../utils/response';

@ApiTags('categories')
@Controller(CATEGORY_ROUTES.root)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  async findAll() {
    // 返回树版本 + 平铺列表 + 嵌套树，前端移动分类时回传 treeVersion 做乐观锁
    return ok(await this.categoryService.getTreeSnapshot());
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
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async move(@Param('id') id: string, @Body() payload: MoveCategoryDto) {
    return ok(await this.categoryService.moveCategory(id, payload), '分类已移动，其下级层级随之一并迁移');
  }
}
