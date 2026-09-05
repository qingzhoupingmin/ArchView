import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, PERMISSIONS } from '@archview/core';
import type { Actor } from '../auth/actor';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 工程归属过滤的**唯一**入口（数据隔离专项·批次 B / S5）。
 *
 * 改造前 `isSuper ? {} : { ownerId }` 这类判定在本文件里散落 5 处（listFor / getFull /
 * update / remove / findVisible 各写各的），将来新增房间库、素材分享、批量导出等接口时
 * 漏写一个 where 就是一个越权洞，而当时的测试对此完全无覆盖。
 * 现在：service 只做编排，所有 project 查询必须经此处；`test/arch.test.ts` 有一条
 * 静态闸门禁止 service 直接碰 `prisma.project.*`。
 */

/** 摘要行（列表用，刻意不含 dataJson） */
export interface ProjectSummaryRow {
  id: string;
  name: string;
  ownerId: string;
  visibility: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  owner: { nickname: string; username: string; deletedAt: Date | null } | null;
}

/** 完整行（打开 / 编辑用） */
export interface ProjectFullRow extends ProjectSummaryRow {
  dataJson: string;
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  visibility: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { nickname: true, username: true, deletedAt: true } },
};

const FULL_SELECT = { ...SUMMARY_SELECT, dataJson: true };

@Injectable()
export class ProjectRepository {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 「能否看全部工程」的唯一判定：走 core 的权限点映射（前后端同一份定义），
   * 不再散落 `role === 'super_admin'` 硬编码字符串。
   */
  canViewAll(actor: Actor): boolean {
    return hasPermission(actor.role, PERMISSIONS.PROJECT_VIEW_ALL);
  }

  /**
   * 列表：只取摘要列。
   * 改造前 `findMany()` 不带 select，会把命中范围内每条工程完整的 dataJson（可能数 MB）
   * 全量拉进 Node 内存再 map 成摘要 —— 超管点一次首页 = 全站工程数据过一遍内存，
   * 既是性能问题，也是对敏感数据本体的过度读取。
   */
  async listSummaries(actor: Actor): Promise<ProjectSummaryRow[]> {
    const rows = await this.prisma.project.findMany({
      // 超管看全部（含已软删 / 禁用账号的工程：交接与清理需要看得见），普通用户仅本人
      where: this.canViewAll(actor) ? {} : { ownerId: actor.id },
      orderBy: { updatedAt: 'desc' },
      select: SUMMARY_SELECT,
    });
    return rows as unknown as ProjectSummaryRow[];
  }

  /** 读：属主本人，或凭 PROJECT_VIEW_ALL 的超管（FR-U06） */
  async findVisible(actor: Actor, id: string): Promise<ProjectFullRow> {
    const row = await this.prisma.project.findFirst({
      where: this.canViewAll(actor) ? { id } : { id, ownerId: actor.id },
      select: FULL_SELECT,
    });
    if (!row) throw new NotFoundException('工程不存在');
    return row as unknown as ProjectFullRow;
  }

  /**
   * 写：仅属主。超管亦不可改他人工程（保持 v1 的最小权限口径）。
   * 404 而非 403：不向非属主泄露「这个 ID 确实存在、只是不归你」。
   */
  async findOwned(actor: Actor, id: string): Promise<ProjectFullRow> {
    const row = await this.prisma.project.findFirst({
      where: { id, ownerId: actor.id },
      select: FULL_SELECT,
    });
    if (!row) throw new NotFoundException('工程不存在');
    return row as unknown as ProjectFullRow;
  }

  async create(actor: Actor, name: string, dataJson: string): Promise<ProjectFullRow> {
    const row = await this.prisma.project.create({
      data: { name, ownerId: actor.id, dataJson },
      select: FULL_SELECT,
    });
    return row as unknown as ProjectFullRow;
  }

  /** 该账号的工程数（配额与「硬删会连带清掉多少工程」的审计口径） */
  countOwned(actor: Actor) {
    return this.prisma.project.count({ where: { ownerId: actor.id } });
  }

  /** 按 ownerId 计数（UsersService 硬删账号前评估连带影响；归属查询统一走本层） */
  countByOwner(ownerId: string) {
    return this.prisma.project.count({ where: { ownerId } });
  }

  /**
   * 提交改动（乐观锁，批次 D / S9）：
   * baseVersion 缺省时按旧行为直接覆盖（兼容未升级的调用方）；带上时版本不符即 409，
   * 避免同账号多标签页 / 多端各持一份全量 dataJson 互相吞改动。
   */
  async commit(
    actor: Actor,
    id: string,
    patch: { name?: string; dataJson?: string },
    baseVersion?: number,
  ): Promise<ProjectFullRow> {
    const current = await this.findOwned(actor, id);
    if (baseVersion !== undefined && baseVersion !== current.version) {
      throw new ConflictException({
        code: 'PROJECT_CONFLICT',
        message: '该工程已被其它端更新，请刷新后重试',
        detail: { serverVersion: current.version, baseVersion },
      });
    }
    // 条件更新：并发下两个请求都通过了上面的版本检查时，只有一个能命中 version，
    // 另一个 count = 0 → 同样报 409，不会静默覆盖。
    const updated = await this.prisma.project.updateMany({
      where: { id, version: current.version },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.dataJson !== undefined ? { dataJson: patch.dataJson } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: 'PROJECT_CONFLICT',
        message: '该工程正在被并发修改，请稍后重试',
        detail: { serverVersion: current.version },
      });
    }
    return this.findOwned(actor, id);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.findOwned(actor, id);
    await this.prisma.project.delete({ where: { id } });
  }
}
