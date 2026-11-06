import mitt from 'mitt'
import type { Emitter } from 'mitt'
import type { types } from '../../wailsjs/go/models'

/**
 * 全局事件表：集中声明每个事件名对应的载荷类型。
 * 各组件在 on/emit 时由 TS 校验载荷，避免字符串事件名 + 任意载荷造成的静默失配。
 *
 * 注意必须是 type alias（而非 interface）——mitt 的泛型约束要求
 * `Record<string, unknown>`，只有类型别名才会被赋予隐式索引签名。
 */
export type AppEvents = {
  /** 切换集群连接（Conn 页连接成功后广播） */
  selectNode: types.Connect
  /** 切换主题，值为 'light' | 'dark' */
  update_theme: string
  /** 切换左侧菜单，值为菜单 key */
  menu_select: string
  /** 切换语言，值为 locale（如 'zh-CN'） */
  change_language: string
  /** 顶部标题状态色，值为 badge 语义色 */
  changeTitleType: string
}

const emitter: Emitter<AppEvents> = mitt<AppEvents>()
export default emitter
