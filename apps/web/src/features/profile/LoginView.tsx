import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { Alert, Button, Card, Input, Spinner } from '@ahead/ui'
import { useAuthSession } from '../../stores'
import { patProvider, oauthProvider } from '../../lib/auth'
export function LoginPage() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const session = useAuthSession((state) => state.session)
  const loading = useAuthSession((state) => state.loading)
  const setSession = useAuthSession((state) => state.setSession)
  const restoreError = useAuthSession((state) => state.restoreError)
  const setRestoreError = useAuthSession((state) => state.setRestoreError)
  const displayError = error || restoreError

  const loginWithPat = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setRestoreError(null)
    try {
      setSession(await patProvider.authenticate({ token }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    }
  }

  if (loading) {
    return (
      <Card className="mx-auto flex max-w-lg flex-col items-center gap-3 py-12">
        <Spinner />
        <p className="text-sm text-slate-600">正在恢复登录态…</p>
      </Card>
    )
  }

  if (session) {
    return <Navigate to="/mine" replace />
  }

  return (
    <Card className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold">登录 Ahead</h1>
      <p className="mt-2 text-sm text-slate-600">
        PAT 与 GitHub OAuth 凭证均保存在此设备的 IndexedDB 中。Auth 服务负责授权跳转、App 安装引导与令牌刷新；若尚未安装 GitHub App，会先进入安装页，安装完成后由 Auth 自动把 token 带回本页落盘。
      </p>
      <form className="mt-6" onSubmit={loginWithPat}>
        <label className="block text-sm">GitHub Personal Access Token<Input className="mt-1" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <Button className="mt-4 w-full" type="submit">使用 PAT 登录</Button>
      </form>
      {oauthProvider.available && <Button className="mt-3 w-full bg-white text-slate-950 ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => void oauthProvider.authenticate()}>使用 GitHub OAuth</Button>}
      {displayError && <Alert className="mt-4" tone="error">{displayError}</Alert>}
    </Card>
  )
}
