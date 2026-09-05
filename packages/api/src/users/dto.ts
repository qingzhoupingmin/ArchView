import { IsIn, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsIn(['user', 'super_admin'])
  role?: 'user' | 'super_admin';

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class SetRoleDto {
  @IsIn(['user', 'super_admin'])
  role!: 'user' | 'super_admin';
}

/** 启用 / 禁用（FR-U05） */
export class SetStatusDto {
  @IsIn(['active', 'disabled'])
  status!: 'active' | 'disabled';
}

/** 重置密码（FR-U05） */
export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;
}
