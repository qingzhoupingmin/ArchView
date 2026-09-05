import { ConflictException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { Actor } from '../auth/actor';
import { AUDIT, AuditService } from '../audit/audit.service';
import { CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectFullRow, ProjectRepository, ProjectSummaryRow } from './project.repository';

/** 单账号工程数上限（防无节制堆积；后续随 FR-U07 系统设置可配） */
const MAX_PROJECTS_PER_USER = 200;
/** 工程 JSON 上限（字符数）：约 16MB，配合 main.ts 的 body 限额挡超大包 */
const MAX_DATA_JSON_CHARS = 16 * 1024 * 1024;

/**
 * 工程管理（FR-U07 / T1.5）：数据本体以 JSON 落库（.archview 同源，FR-I01）。
 * 归属与可见性一律下沉到 ProjectRepository（数据隔离专项·批次 B），
 * 本文件只做编排 + 摘要映射 + 审计埋点，不再出现任何 `prisma.project.*`。
 */
@Injectable()
export class ProjectsService {
  // @Inject 显式令牌：不依赖 design:paramtypes（esbuild/tsx/vitest 转换下元数据可能缺失）
  constructor(
    @Inject(ProjectRepository) private readonly repo: ProjectRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** 工程列表：普通用户仅本人；持 project:view-all 者看全部（FR-U06） */
  async listFor(actor: Actor) {
    const rows = await this.repo.listSummaries(actor);
    return rows.map((p) => this.toSummary(p, actor));
  }

  async create(actor: Actor, dto: CreateProjectDto, ip?: string | null) {
    const owned = await this.repo.countOwned(actor);
    if (owned >= MAX_PROJECTS_PER_USER) {
      throw new ConflictException(
        `已达单账号工程数上限（${MAX_PROJECTS_PER_USER}），请先清理旧工程`,
      );
    }
    const p = await this.repo.create(
      actor,
      dto.name,
      this.stringifyData(dto.data ?? {}, MAX_DATA_JSON_CHARS),
    );
    this.audit.record({ userId: actor.id, ip, action: AUDIT.PROJECT_CREATE, target: p.id });
    return this.toSummary(p, actor);
  }

  /**
   * 打开工程：属主或持 project:view-all 的超管（FR-U06）；编辑 / 删除仅属主。
   * 超管读他人工程会留痕（批次 D）—— 这是隔离事故追溯最关键的一条记录。
   */
  async getFull(actor: Actor, id: string, ip?: string | null) {
    const p = await this.repo.findVisible(actor, id);
    if (p.ownerId !== actor.id) {
      this.audit.record({
        userId: actor.id,
        ip,
        action: AUDIT.PROJECT_READ_FOREIGN,
        target: id,
        detail: { ownerId: p.ownerId },
      });
    }
    return {
      id: p.id,
      name: p.name,
      visibility: p.visibility,
      ownerId: p.ownerId,
      /** 乐观锁基线（批次 D）：前端 PATCH 时原样带回 baseVersion */
      version: p.version,
      /** 本账号能否写该工程（服务端算好，前端只消费，两侧判定不可能再漂移） */
      canEdit: p.ownerId === actor.id,
      updatedAt: p.updatedAt,
      data: JSON.parse(p.dataJson) as unknown,
    };
  }

  async update(actor: Actor, id: string, dto: UpdateProjectDto, ip?: string | null) {
    const dataJson =
      dto.data !== undefined ? this.stringifyData(dto.data, MAX_DATA_JSON_CHARS) : undefined;
    let updated: ProjectFullRow;
    try {
      updated = await this.repo.commit(actor, id, { name: dto.name, dataJson }, dto.baseVersion);
    } catch (err) {
      // 冲突也是隔离相关事件（多端互写），留痕后再抛给前端
      this.audit.record({
        userId: actor.id,
        ip,
        action: AUDIT.PROJECT_CONFLICT,
        target: id,
        detail: { message: (err as Error).message },
      });
      throw err;
    }
    this.audit.record({ userId: actor.id, ip, action: AUDIT.PROJECT_UPDATE, target: updated.id });
    return this.toSummary(updated, actor);
  }

  async remove(actor: Actor, id: string, ip?: string | null) {
    await this.repo.remove(actor, id);
    this.audit.record({ userId: actor.id, ip, action: AUDIT.PROJECT_DELETE, target: id });
    return { id };
  }

  private stringifyData(data: unknown, maxChars: number): string {
    const json = JSON.stringify(data);
    if (json.length > maxChars) {
      throw new PayloadTooLargeException('工程数据过大，请拆分或清理后重试');
    }
    return json;
  }

  /**
   * 摘要（批次 B / S3）：补 ownerId + 属主名 + canEdit + ownerDeleted。
   * 此前超管在列表里看到的是几十个无法区分归属的同名卡片，且行内「重命名 / 删除」
   * 对他人工程必然 404 —— 用户只会觉得「数据串了」。
   */
  private toSummary(p: ProjectSummaryRow | ProjectFullRow, actor: Actor) {
    return {
      id: p.id,
      name: p.name,
      visibility: p.visibility,
      ownerId: p.ownerId,
      ownerName: p.owner?.nickname || p.owner?.username || '已删除账号',
      /** 属主已被软删：工程成为无主孤儿，超管需要看得见才能清理（批次 D） */
      ownerDeleted: !!p.owner?.deletedAt,
      /** 写权限仅属主（超管亦不可写）；前端据此置灰行内操作、进建模页时开只读门 */
      canEdit: p.ownerId === actor.id,
      version: p.version,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
