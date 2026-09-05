import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 修改个人资料（FR-U04：昵称 / 邮箱 / 预设头像，v1 不做上传） */
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  avatar?: string;
}

/** 修改密码（FR-U04：验证旧密码） */
export class ChangePasswordDto {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(128)
  newPassword!: string;
}
