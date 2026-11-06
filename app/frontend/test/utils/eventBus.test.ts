import {describe, it, expect, vi} from 'vitest'
import emitter from '../../src/utils/eventBus'

describe('eventBus', () => {
  it('on/emit 应收到事件载荷', () => {
    const received: string[] = []
    emitter.on('change_language', payload => received.push(payload))
    emitter.emit('change_language', 'zh-CN')
    emitter.emit('change_language', 'en')
    expect(received).toEqual(['zh-CN', 'en'])
    emitter.off('change_language')
  })

  it('off 后不再接收', () => {
    const handler = vi.fn()
    emitter.on('change_language', handler)
    emitter.off('change_language', handler)
    emitter.emit('change_language', 'en')
    expect(handler).not.toHaveBeenCalled()
  })

  it('通配符 * 监听所有事件', () => {
    const all: unknown[][] = []
    const handler = (type: string | symbol, payload: unknown) => all.push([type, payload])
    emitter.on('*', handler)
    emitter.emit('update_theme', 'dark')
    emitter.off('*', handler)
    emitter.emit('menu_select', 'nodes')
    expect(all).toEqual([['update_theme', 'dark']])
  })

  it('off(type, handler) 只移除指定 handler，不影响其他订阅者', () => {
    const a = vi.fn()
    const b = vi.fn()
    emitter.on('menu_select', a)
    emitter.on('menu_select', b)
    emitter.off('menu_select', a)
    emitter.emit('menu_select', 'nodes')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    emitter.off('menu_select')
  })

  it('off(type) 不带 handler 时清空该事件所有订阅者', () => {
    const a = vi.fn()
    const b = vi.fn()
    emitter.on('changeTitleType', a)
    emitter.on('changeTitleType', b)
    emitter.off('changeTitleType')
    emitter.emit('changeTitleType', 'success')
    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })
})
