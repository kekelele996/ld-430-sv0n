import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

export class MoveCategoryDto {
  @ApiPropertyOptional({
    description: '目标父分类 ID；传 null 或省略表示移动为根分类',
    example: '65f1c2e8a3b1c4d5e6f7a890',
    nullable: true,
  })
  @ValidateIf((dto: MoveCategoryDto) => dto.parentCategoryId !== null)
  @IsOptional()
  @IsMongoId({ message: '父分类 ID 不是合法的 Mongo ID' })
  parentCategoryId?: string | null;

  @ApiProperty({
    description:
      '发起移动时看到的树版本（GET /categories 返回的 treeVersion）。' +
      '期间有其他管理员先移动过分类则版本不匹配，本次移动被拒绝。',
    example: 3,
  })
  @IsInt({ message: 'treeVersion 必须是整数' })
  @Min(0)
  treeVersion!: number;
}
