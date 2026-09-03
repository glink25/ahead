const zhCN = {
  home: '盼头',
  discover: '发现',
  following: '关注',
  studio: '创作',
  me: '我的',
  login: '登录',
  emptyFollowing: '登录后，你关注的事件源会出现在这里。',
  upcoming: '接下来值得期待',
} as const

export type MessageKey = keyof typeof zhCN
export const t = (key: MessageKey): string => zhCN[key]
