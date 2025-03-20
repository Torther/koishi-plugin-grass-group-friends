import { Context, isNullable, Random, Session, Time, Universal } from "koishi";
import { Config } from "./types";

export class GrassService {
  constructor(private ctx: Context, private cfg: Config) {}

  // 缓存键生成工具
  private getCacheKey(type: 'members' | 'last_time' | 'toggle_last_time' | 'disabled', gid: string, uid?: string): string {
    const key = `ggf_${type}_${gid}`;
    return uid ? `${key}:${uid}` : key;
  }

  // 更新成员信息
  async updateMemberInfo(session: Session): Promise<void> {
    if (isNullable(session.userId)) return;
    try {
      const member: Universal.GuildMember = session.event.member || {
        user: session.event.user,
      };
      this.ctx.logger.debug(`[grass-group-friends] 更新成员信息: ${session.gid}:${session.userId}`);
      this.ctx.logger.debug(`[grass-group-friends] 成员数据: ${JSON.stringify(member)}`);
      await this.ctx.cache.set(
        'ggf_members_',
        this.getCacheKey('members', session.gid, session.userId),
        member,
        2 * Time.day
      );
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 更新成员信息失败: ${error.message}`);
    }
  }

  // 检查用户是否被禁用
  async checkUserDisabled(session: Session, uid: string): Promise<boolean> {
    try {
      const isDisabled = await this.ctx.cache.get('ggf_disabled_', this.getCacheKey('disabled', session.gid, uid));
      this.ctx.logger.debug(`[grass-group-friends] 检查用户禁用状态: ${session.gid}:${uid} = ${isDisabled}`);
      return !!isDisabled;
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 检查用户禁用状态失败: ${error.message}`);
      return false;
    }
  }

  // 检查用户是否在冷却时间内
  async checkCooldown(session: Session, uid: string, cooldown: number): Promise<string | null> {
    try {
      const lastTime = await this.ctx.cache.get('ggf_last_time_', this.getCacheKey('last_time', session.gid, uid));
      const now = Date.now();
      this.ctx.logger.debug(`[grass-group-friends] 检查冷却时间: ${session.gid}:${uid}, 上次使用: ${lastTime}, 当前: ${now}`);

      if (lastTime && now - lastTime < cooldown * 1000) {
        const waitTime = Math.ceil((cooldown * 1000 - (now - lastTime)) / 1000);
        return session.text(".coolDown", [waitTime]);
      }
      return null;
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 检查冷却时间失败: ${error.message}`);
      return null;
    }
  }

  // 获取群成员列表
  async getMemberList(session: Session, gid: string): Promise<Universal.GuildMember[]> {
    let result: Universal.GuildMember[] = [];
    
    // 首先尝试从缓存获取
    try {
      this.ctx.logger.debug(`[grass-group-friends] 从缓存获取群成员列表: ${gid}`);
      for await (const value of this.ctx.cache.values('ggf_members_')) {
        if (value && value.user) {
          result.push(value);
        }
      }
      this.ctx.logger.debug(`[grass-group-friends] 缓存获取成功，成员数量: ${result.length}`);
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 从缓存获取群成员列表失败: ${error.message}`);
    }

    // 如果缓存为空，尝试从API获取
    if (!result.length) {
      try {
        this.ctx.logger.debug(`[grass-group-friends] 尝试从 API 获取群成员列表: ${gid}`);
        const { data, next } = await session.bot.getGuildMemberList(session.guildId);
        result = data || [];
        if (next) {
          try {
            const { data } = await session.bot.getGuildMemberList(session.guildId, next);
            if (data) result.push(...data);
          } catch (error) {
            this.ctx.logger.warn(`[grass-group-friends] 获取下一页群成员列表失败: ${error.message}`);
          }
        }
        this.ctx.logger.debug(`[grass-group-friends] API 获取成功，成员数量: ${result.length}`);

        // 更新缓存
        if (result.length > 0) {
          for (const member of result) {
            if (member.user?.id) {
              try {
                await this.ctx.cache.set(
                  'ggf_members_',
                  this.getCacheKey('members', gid, member.user.id),
                  member,
                  2 * Time.day
                );
              } catch (error) {
                this.ctx.logger.warn(`[grass-group-friends] 更新成员缓存失败: ${error.message}`);
              }
            }
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`[grass-group-friends] 获取群成员列表失败: ${error.message}`);
      }
    }

    // 如果API和缓存都失败了，至少返回当前用户
    if (!result.length && session.event.member) {
      result.push(session.event.member);
    }

    return result;
  }

  // 获取成员信息
  getMemberInfo(member: Universal.GuildMember, id: string): [string, string | undefined] {
    try {
      const name = member?.nick || member?.user?.nick || member?.user?.name || id;
      const avatar = member?.avatar || member?.user?.avatar;
      return [name, avatar];
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 获取成员信息失败: ${error.message}`);
      return [id, undefined];
    }
  }

  // 更新用户最后使用时间
  async updateLastUsedTime(gid: string, uid: string): Promise<void> {
    try {
      await this.ctx.cache.set('ggf_last_time_', this.getCacheKey('last_time', gid, uid), Date.now());
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 更新用户最后使用时间失败: ${error.message}`);
    }
  }

  // 更新用户禁用状态
  async updateUserDisabledState(gid: string, uid: string, disabled: boolean): Promise<void> {
    try {
      await this.ctx.cache.set('ggf_disabled_', this.getCacheKey('disabled', gid, uid), disabled);
      await this.ctx.cache.set('ggf_toggle_last_time_', this.getCacheKey('toggle_last_time', gid, uid), Date.now());
    } catch (error) {
      this.ctx.logger.warn(`[grass-group-friends] 更新用户禁用状态失败: ${error.message}`);
      throw error;
    }
  }

  // 随机选择一个未被禁用的群友
  async getRandomTarget(session: Session, memberList: Universal.GuildMember[]): Promise<Universal.GuildMember | null> {
    const list = memberList.filter(
      (v) => v.user && !v.user.isBot && v.user.id !== session.userId
    );

    if (list.length === 0) return null;

    const availableList = [...list];
    while (availableList.length > 0) {
      const index = Random.int(0, availableList.length - 1);
      const target = availableList[index];
      if (!(await this.checkUserDisabled(session, session.platform + ":" + target.user.id))) {
        return target;
      }
      availableList.splice(index, 1);
    }

    return null;
  }
} 