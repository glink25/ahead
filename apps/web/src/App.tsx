import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useParams } from 'react-router'
import { EventEditorState } from '@ahead/editor'
import { GitHubOAuthProvider, PersonalAccessTokenProvider } from '@ahead/github'
import { assignBucket, type RecommendationBucket } from '@ahead/recommendation'
import { Alert, Badge, Button, Card, Input, Spinner, TextArea } from '@ahead/ui'
import { t } from './i18n'
import { useActiveProfile, useAuthSession } from './stores'
import { indexedDbTokenStore } from './token-store'

const patProvider = new PersonalAccessTokenProvider(indexedDbTokenStore)
const oauthProvider = new GitHubOAuthProvider({
  authBaseUrl: import.meta.env.VITE_AUTH_BASE_URL,
  redirectUri: `${location.origin}/login`,
})

const mockEvents = [
  { id: 'autumn-equinox', title: '秋分', date: '2026-09-23', source: '自然节律' },
  { id: 'national-day', title: '国庆假期', date: '2026-10-01', source: '公共节日' },
  { id: 'new-year', title: '新年', date: '2027-01-01', source: '公共节日' },
]

const bucketLabels: Record<RecommendationBucket, string> = {
  '0-7d': '一周内',
  '7-30d': '本月',
  '1-3m': '三个月内',
  '3-12m': '今年',
  '1y+': '更远以后',
  unknown: '日期待定',
}

function eventBucket(date: string): string {
  const days = Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000)
  return bucketLabels[assignBucket(days)]
}

function Shell({ children }: { children: ReactNode }) {
  const session = useAuthSession((state) => state.session)
  const links: Array<readonly [string, string]> = [
    ['/', t('home')],
    ['/discover', t('discover')],
    ['/following', t('following')],
    ['/studio', t('studio')],
    ['/me', t('me')],
  ]
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav aria-label="主导航" className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-3">
          <Link to="/" className="mr-4 flex items-center gap-2 text-lg font-bold">
            <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
            Ahead<span className="text-sky-600">.</span>
          </Link>
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </NavLink>
          ))}
          <Link to="/login" className="ml-auto whitespace-nowrap text-sm text-slate-600">
            {session?.identity.login ?? t('login')}
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

function HomePage() {
  const [spotlight, setSpotlight] = useState(() => pickRandom(mockEvents))
  return (
    <>
      <section className="mb-10 rounded-3xl bg-slate-950 p-8 text-white">
        <Badge className="mb-4 bg-sky-400/20 text-sky-200">Ahead / 盼头</Badge>
        <h1 className="max-w-xl text-4xl font-bold tracking-tight">把值得期待的日子，放在眼前。</h1>
        <p className="mt-3 text-slate-300">聚合开放事件源，按与你的距离组织未来。</p>
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl bg-white/5 p-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">随机盼头</p>
            <Link className="text-lg font-semibold text-sky-200 hover:text-white" to={`/events/${spotlight.id}`}>
              {spotlight.title}
            </Link>
          </div>
          <Button
            className="ml-auto bg-white/10 text-white hover:bg-white/20"
            onClick={() => setSpotlight(pickRandom(mockEvents))}
          >
            换一个
          </Button>
        </div>
      </section>
      <h2 className="mb-4 text-xl font-semibold">{t('upcoming')}</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {mockEvents.map((event) => (
          <Link key={event.id} to={`/events/${event.id}`}>
            <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:transform-none">
              <p className="text-xs font-medium text-sky-700">{eventBucket(event.date)}</p>
              <h3 className="mt-2 text-lg font-semibold">{event.title}</h3>
              <p className="mt-4 text-sm text-slate-500">{event.date}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  )
}

interface MarketIssue {
  id: number
  title: string
  html_url: string
  labels: Array<{ name?: string }>
}

function DiscoverPage() {
  const [issues, setIssues] = useState<MarketIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const repository = import.meta.env.VITE_GITHUB_MARKET_REPOSITORY as string | undefined

  useEffect(() => {
    if (!repository) return
    setLoading(true)
    fetch(`https://api.github.com/repos/${repository}/issues?state=open&labels=approved&per_page=30`)
      .then((response) => response.ok ? response.json() as Promise<MarketIssue[]> : Promise.reject(new Error('市场读取失败')))
      .then(setIssues)
      .catch(() => setIssues([]))
      .finally(() => setLoading(false))
  }, [repository])

  const filtered = (issues.length ? issues : mockEvents).filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase()),
  )

  return (
    <>
      <h1 className="text-3xl font-bold">发现公开事件源</h1>
      <p className="mt-2 text-slate-600">无需登录即可浏览社区提交。仅展示带 approved 标签的条目。</p>
      <Input
        className="mt-6"
        aria-label="搜索市场"
        placeholder="本地过滤标题…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {loading && <Spinner className="mt-8" />}
      <div className="mt-6 grid gap-3">
        {filtered.map((item) => {
          const issue = 'html_url' in item
          return (
            <Card key={item.id}>
              <h2 className="font-semibold">{item.title}</h2>
              {issue
                ? <a className="mt-2 inline-block text-sm text-sky-700" href={item.html_url} target="_blank" rel="noreferrer">查看 GitHub 提交 →</a>
                : <p className="mt-2 text-sm text-slate-500">{item.source}</p>}
            </Card>
          )
        })}
      </div>
    </>
  )
}

function FollowingPage() {
  const session = useAuthSession((state) => state.session)
  return (
    <>
      <h1 className="text-3xl font-bold">关注</h1>
      <Alert className="mt-6">{session ? '你关注的事件源将在同步后显示。' : t('emptyFollowing')}</Alert>
    </>
  )
}

function StudioPage() {
  const initial = useMemo(() => EventEditorState.fromEvent({
    id: 'new-event',
    title: { 'zh-CN': '新的盼头' },
    schedule: [{
      id: 'initial',
      value: { kind: 'exact', date: new Date().toISOString().slice(0, 10) },
      recordedAt: new Date().toISOString(),
    }],
  }), [])
  const [editor] = useState(initial)
  const [title, setTitle] = useState(editor.toEvent().title['zh-CN'] ?? '')
  const [date, setDate] = useState((editor.toEvent().schedule[0]?.value as { date?: string }).date ?? '')
  const [durationAmount, setDurationAmount] = useState('')
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours' | 'days' | 'weeks'>('days')
  const [yaml, setYaml] = useState(editor.yaml)
  const [message, setMessage] = useState<string>()

  const validateForm = () => {
    editor
      .setField('title', { 'zh-CN': title })
      .setField('schedule', [{
        id: 'initial',
        value: { kind: 'exact', date },
        recordedAt: new Date().toISOString(),
      }])
    const amount = Number(durationAmount)
    if (durationAmount.trim() && Number.isInteger(amount) && amount >= 1) {
      editor.setDuration({ amount, unit: durationUnit })
    } else {
      editor.setDuration(undefined)
    }
    setYaml(editor.yaml)
    showResult(editor.validate())
  }
  const validateYaml = () => {
    editor.setYaml(yaml)
    showResult(editor.validate())
  }
  const showResult = (result: ReturnType<typeof editor.validate>) => {
    setMessage(result.ok
      ? '校验通过，可以提交。'
      : result.message ?? result.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('；') ?? '校验失败')
  }

  return (
    <>
      <h1 className="text-3xl font-bold">Studio</h1>
      <p className="mt-2 text-slate-600">表单与 YAML 使用同一个 schema 校验器。持续时间与开始日期正交，可与重复规则并存。</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">表单模式</h2>
          <label className="mb-4 block text-sm">标题<Input className="mt-1" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="mb-4 block text-sm">准确日期（开始）<Input className="mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="block text-sm">持续数量
              <Input
                className="mt-1"
                inputMode="numeric"
                placeholder="可选"
                value={durationAmount}
                onChange={(event) => setDurationAmount(event.target.value)}
              />
            </label>
            <label className="block text-sm">单位
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={durationUnit}
                onChange={(event) => setDurationUnit(event.target.value as typeof durationUnit)}
                aria-label="持续单位"
              >
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
                <option value="weeks">周</option>
              </select>
            </label>
          </div>
          <Button onClick={validateForm}>校验表单</Button>
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">YAML 模式</h2>
          <TextArea aria-label="事件 YAML" className="min-h-72 font-mono text-sm" value={yaml} onChange={(event) => setYaml(event.target.value)} />
          <Button className="mt-4" onClick={validateYaml}>校验 YAML</Button>
        </Card>
      </div>
      {message && <Alert className="mt-4" tone={message.startsWith('校验通过') ? 'success' : 'error'}>{message}</Alert>}
    </>
  )
}

function LoginPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const setSession = useAuthSession((state) => state.setSession)

  const loginWithPat = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      setSession(await patProvider.authenticate({ token }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    }
  }

  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold">登录 Ahead</h1>
      <p className="mt-2 text-sm text-slate-600">令牌仅保存在此设备的 IndexedDB 中。</p>
      <form className="mt-6" onSubmit={loginWithPat}>
        <label className="block text-sm">GitHub Personal Access Token<Input className="mt-1" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <Button className="mt-4 w-full" type="submit">使用 PAT 登录</Button>
      </form>
      {oauthProvider.available && <Button className="mt-3 w-full bg-white text-slate-950 ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => void oauthProvider.authenticate()}>使用 GitHub OAuth</Button>}
      {error && <Alert className="mt-4" tone="error">{error}</Alert>}
    </Card>
  )
}

function MePage() {
  const session = useAuthSession((state) => state.session)
  const profile = useActiveProfile((state) => state.profile)
  return (
    <>
      <h1 className="text-3xl font-bold">我的</h1>
      <Card className="mt-6">
        {session ? <><p className="font-semibold">@{session.identity.login}</p><p className="mt-1 text-sm text-slate-500">{profile ? '已加载个人资料' : '个人资料尚未同步'}</p></> : <Link className="text-sky-700" to="/login">登录以管理个人资料 →</Link>}
      </Card>
    </>
  )
}

function EventPage() {
  const { id } = useParams()
  const event = mockEvents.find((candidate) => candidate.id === id)
  return event ? (
    <Card>
      <Badge>{event.source}</Badge>
      <h1 className="mt-4 text-3xl font-bold">{event.title}</h1>
      <p className="mt-3 text-slate-600">准确日期：{event.date}</p>
    </Card>
  ) : <Alert tone="error">没有找到这个事件。</Alert>
}

export function App() {
  const setSession = useAuthSession((state) => state.setSession)
  const setLoading = useAuthSession((state) => state.setLoading)
  useEffect(() => {
    Promise.all([patProvider.restore(), oauthProvider.restore()])
      .then(([pat, oauth]) => setSession(oauth ?? pat))
      .finally(() => setLoading(false))
  }, [setLoading, setSession])

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/following" element={<FollowingPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/events/:id" element={<EventPage />} />
      </Routes>
    </Shell>
  )
}
