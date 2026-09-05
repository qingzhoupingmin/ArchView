import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** 工程数据（core Project JSON，FR-U07） */
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  /**
   * 乐观锁基线（数据隔离专项·批次 D / S9）：取自 GET /projects/:id 返回的 version。
   * 缺省 = 旧行为直接覆盖（兼容未升级客户端）；带上且与服务端不一致 → 409 PROJECT_CONFLICT。
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  baseVersion?: number;
}
